import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
import { InvoiceService } from './invoice.service';
import { IInvoiceRepository, TransitionOptions } from './invoice.repository.interface';

type MockCache = { get: jest.Mock; set: jest.Mock; del: jest.Mock };
type MockRedis = { get: jest.Mock; incr: jest.Mock };
type MockAuditLog = { record: jest.Mock };
type MockPdfGeneratorClient = { generateInvoicePdf: jest.Mock };
type MockMediaClient = { uploadFile: jest.Mock; getDownloadUrl: jest.Mock };
type MockEventsProducer = { enqueueDemo: jest.Mock; enqueueSent: jest.Mock; enqueueCancelled: jest.Mock };
type MockCustomers = { snapshotOf: jest.Mock };
type MockNumbering = { prepare: jest.Mock; next: jest.Mock };

// Stands in for the transaction's ClientSession: events must be enqueued with exactly this object.
const SESSION = { id: 'txn-session' };

const buildInvoiceDoc = (overrides: Record<string, unknown> = {}) => {
  const base = {
    _id: { toString: () => overrides['id'] ?? 'invoice-1' },
    toJSON: () => ({ id: overrides['id'] ?? 'invoice-1', invoiceNumber: 'INV-0001', ...overrides }),
  };
  return base as unknown as Awaited<ReturnType<IInvoiceRepository['create']>>;
};

const ID = '507f1f77bcf86cd799439011';
const CLIENT = { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Main St' };
const PREPARED = { organizationId: ORG, prefix: 'ACME', year: 2026 };

// A document with everything PDF rendering and the invoice.sent event read.
const buildFullInvoiceDoc = (status: string) => {
  const fields = {
    id: ID,
    invoiceNumber: 'INV-0001',
    status,
    client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Main St' },
    items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPrice: 100, vatRate: 20, total: 120 }],
    currency: 'EUR',
    issueDate: new Date('2026-10-01T00:00:00.000Z'),
    dueDate: undefined,
    notes: undefined,
    subtotal: 100,
    vatTotal: 20,
    total: 120,
  };
  return { ...fields, _id: { toString: () => ID }, toJSON: () => fields } as unknown as Awaited<
    ReturnType<IInvoiceRepository['create']>
  >;
};

describe('InvoiceService', () => {
  let repository: jest.Mocked<IInvoiceRepository>;
  let cacheManager: MockCache;
  let redis: MockRedis;
  let auditLog: MockAuditLog;
  let pdfGeneratorClient: MockPdfGeneratorClient;
  let mediaClient: MockMediaClient;
  let eventsProducer: MockEventsProducer;
  let customers: MockCustomers;
  let numbering: MockNumbering;
  let service: InvoiceService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      setPdfMetadata: jest.fn(),
      transitionStatus: jest.fn(),
    };
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    redis = { get: jest.fn().mockResolvedValue(null), incr: jest.fn().mockResolvedValue(1) };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    pdfGeneratorClient = { generateInvoicePdf: jest.fn() };
    mediaClient = { uploadFile: jest.fn(), getDownloadUrl: jest.fn() };
    eventsProducer = {
      enqueueDemo: jest.fn().mockResolvedValue('evt'),
      enqueueSent: jest.fn().mockResolvedValue('evt'),
      enqueueCancelled: jest.fn().mockResolvedValue('evt'),
    };
    customers = { snapshotOf: jest.fn() };
    numbering = {
      prepare: jest.fn().mockResolvedValue(PREPARED),
      next: jest.fn().mockResolvedValue('ACME-2026-000007'),
    };

    service = new InvoiceService(
      repository,
      cacheManager as never,
      redis as never,
      auditLog as never,
      pdfGeneratorClient as never,
      mediaClient as never,
      eventsProducer as never,
      customers as never,
      numbering as never,
    );
  });

  describe('create', () => {
    it('persists, bumps the list version, and records an audit entry', async () => {
      const created = buildInvoiceDoc({ id: 'invoice-1' });
      repository.create.mockResolvedValue(created);

      const result = await service.create({ client: CLIENT } as never);

      expect(result).toEqual(created.toJSON());
      expect(redis.incr).toHaveBeenCalledWith(`svc:org:${ORG}:invoice:list:version`);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'invoice', entityId: 'invoice-1' }),
      );
    });

    it("enqueues invoice.demo inside the insert's transaction (via the repository hook)", async () => {
      const created = buildInvoiceDoc({ id: 'invoice-1' });
      repository.create.mockImplementation(async (_dto, inTransaction) => {
        await inTransaction?.(created, SESSION as never);
        return created;
      });

      await service.create({ client: CLIENT } as never);

      expect(eventsProducer.enqueueDemo).toHaveBeenCalledWith(SESSION, 'invoice-1');
    });

    // The invoice keeps its own copy: later edits to the customer never change it.
    it("bills a customer by snapshotting the customer's current details onto the invoice", async () => {
      customers.snapshotOf.mockResolvedValue(CLIENT);
      repository.create.mockResolvedValue(buildInvoiceDoc());

      await service.create({ customerId: 'cust-1', currency: 'EUR', items: [] } as never);

      expect(customers.snapshotOf).toHaveBeenCalledWith('cust-1');
      expect(repository.create).toHaveBeenCalledWith(
        { currency: 'EUR', items: [], client: CLIENT, customerId: 'cust-1' },
        expect.any(Function),
      );
    });

    it("is a 404 for a customer that isn't in the caller's organization, before anything is written", async () => {
      customers.snapshotOf.mockRejectedValue(new NotFoundException('Customer not found for id "cust-x".'));

      await expect(service.create({ customerId: 'cust-x' } as never)).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    // Re-checked in the service: RPC payloads skip DTO validation.
    it.each([
      ['both', { customerId: 'cust-1', client: CLIENT }],
      ['neither', {}],
    ])('refuses %s of customerId and client with a 422', async (_label, body) => {
      await expect(service.create(body as never)).rejects.toThrow(
        new UnprocessableEntityException('Give either customerId or client, not both and not neither.'),
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('maps a Mongoose ValidationError to UnprocessableEntityException', async () => {
      const validationError = new MongooseError.ValidationError();
      validationError.errors = {
        dueDate: new MongooseError.ValidatorError({
          message: 'dueDate cannot be earlier than issueDate.',
          path: 'dueDate',
        }),
      };
      repository.create.mockRejectedValue(validationError);

      await expect(service.create({ client: CLIENT } as never)).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rethrows unrecognized errors as-is', async () => {
      const unexpected = new Error('boom');
      repository.create.mockRejectedValue(unexpected);

      await expect(service.create({ client: CLIENT } as never)).rejects.toBe(unexpected);
    });
  });

  describe('findAll', () => {
    it('returns a cached response without hitting the repository', async () => {
      const cached = {
        items: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
      };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.findAll({});

      expect(result).toBe(cached);
      expect(repository.findAll).not.toHaveBeenCalled();
    });

    it('builds and caches an offset-mode response on a cache miss', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      const doc = buildInvoiceDoc({ id: 'invoice-1' });
      repository.findAll.mockResolvedValue({
        items: [doc],
        meta: {
          mode: 'offset',
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.items).toEqual([doc.toJSON()]);
      expect('cursor' in result.meta).toBe(false);
      expect(cacheManager.set).toHaveBeenCalled();
    });

    it('builds and caches a cursor-mode response on a cache miss', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      const doc = buildInvoiceDoc({ id: 'invoice-1' });
      repository.findAll.mockResolvedValue({
        items: [doc],
        meta: { mode: 'cursor', limit: 20, hasNextPage: true, cursor: 'abc' },
      });

      const result = await service.findAll({ cursor: undefined });

      expect(result.meta).toEqual({ limit: 20, hasNextPage: true, cursor: 'abc' });
      expect(cacheManager.set).toHaveBeenCalled();
    });

    it('tolerates cache read/write failures without throwing', async () => {
      cacheManager.get.mockRejectedValue(new Error('cache down'));
      cacheManager.set.mockRejectedValue(new Error('cache down'));
      repository.findAll.mockResolvedValue({
        items: [],
        meta: {
          mode: 'offset',
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      await expect(service.findAll({})).resolves.toBeDefined();
    });
  });

  describe('findOne', () => {
    it('returns a cached response without hitting the repository', async () => {
      const cached = { id: 'invoice-1' };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.findOne('507f1f77bcf86cd799439011');

      expect(result).toBe(cached);
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for a malformed id before touching the repository', async () => {
      await expect(service.findOne('not-an-object-id')).rejects.toThrow(
        '"not-an-object-id" is not a valid invoice id.',
      );
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the repository returns null', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('507f1f77bcf86cd799439011')).rejects.toBeInstanceOf(NotFoundException);
    });

    // Ids are global, but a cached invoice must never be served to another organization.
    it('caches the response under a key scoped to the organization', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      const doc = buildInvoiceDoc({ id: 'invoice-1' });
      repository.findOne.mockResolvedValue(doc);

      const result = await service.findOne(ID);

      expect(result).toEqual(doc.toJSON());
      expect(cacheManager.get).toHaveBeenCalledWith(`svc:org:${ORG}:invoice:one:${ID}`);
      expect(cacheManager.set).toHaveBeenCalledWith(`svc:org:${ORG}:invoice:one:${ID}`, doc.toJSON(), 30_000);
    });
  });

  describe('update', () => {
    it('invalidates the entity cache, bumps the list version, and records an audit entry', async () => {
      const previous = buildInvoiceDoc({ id: 'invoice-1' });
      const updated = buildInvoiceDoc({ id: 'invoice-1', invoiceNumber: 'INV-0002' });
      repository.findOne.mockResolvedValue(previous);
      repository.update.mockResolvedValue(updated);

      const result = await service.update('507f1f77bcf86cd799439011', {}, 3);

      expect(result).toEqual(updated.toJSON());
      expect(cacheManager.del).toHaveBeenCalled();
      expect(redis.incr).toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }));
    });

    it('throws NotFoundException when the repository finds nothing to update', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.update.mockResolvedValue(null);

      await expect(service.update('507f1f77bcf86cd799439011', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates a ConflictException from a stale If-Match version', async () => {
      repository.findOne.mockResolvedValue(buildInvoiceDoc());
      repository.update.mockRejectedValue(new ConflictException('stale version'));

      await expect(service.update('507f1f77bcf86cd799439011', {}, 1)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update audit diff', () => {
    it('records which fields changed, from and to, ignoring bookkeeping fields', async () => {
      repository.findOne.mockResolvedValue(buildInvoiceDoc({ notes: 'old', version: 1 }));
      repository.update.mockResolvedValue(buildInvoiceDoc({ notes: 'new', version: 2 }));

      await service.update(ID, { notes: 'new' });

      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', diff: { notes: { from: 'old', to: 'new' } } }),
      );
    });
  });

  describe('lifecycle transitions', () => {
    it('issues a draft: moves it from every status that can reach issued, invalidates caches, audits the change', async () => {
      const issued = buildFullInvoiceDoc('issued');
      repository.transitionStatus.mockResolvedValue({ outcome: 'transitioned', invoice: issued, from: 'draft' });

      const result = await service.issue(ID);

      expect(repository.transitionStatus).toHaveBeenCalledWith(ID, ['draft'], 'issued', {
        prepare: expect.any(Function),
      });
      expect(result).toEqual(issued.toJSON());
      expect(cacheManager.del).toHaveBeenCalled();
      expect(redis.incr).toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith({
        action: 'STATUS_CHANGE',
        entityType: 'invoice',
        entityId: ID,
        diff: { status: { from: 'draft', to: 'issued' } },
      });
    });

    describe('numbering on issue', () => {
      const NOW = new Date('2026-10-19T10:00:00.000Z');
      // Runs the transition's prepare step the way the repository does, inside the transaction.
      const runPrepare = (draft: Record<string, unknown>) =>
        repository.transitionStatus.mockImplementation(async (_id, _from, _to, options?: TransitionOptions) => {
          const extra = await options?.prepare?.(draft as never, SESSION as never);
          return {
            outcome: 'transitioned',
            invoice: { ...buildFullInvoiceDoc('issued'), ...extra } as never,
            from: 'draft',
          };
        });

      beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] }));
      afterEach(() => jest.useRealTimers());

      it('takes the next number in the issuing transaction and dates the invoice at the moment of issue', async () => {
        runPrepare({ status: 'draft', dueDate: new Date('2026-11-01T00:00:00.000Z') });

        await service.issue(ID);

        expect(numbering.prepare).toHaveBeenCalledWith(NOW);
        expect(numbering.next).toHaveBeenCalledWith(PREPARED, SESSION);
        const extra = await (repository.transitionStatus.mock.calls[0][3] as TransitionOptions).prepare?.(
          { dueDate: undefined } as never,
          SESSION as never,
        );
        expect(extra).toEqual({ invoiceNumber: 'ACME-2026-000007', issueDate: NOW });
      });

      it('accepts a due date of today', async () => {
        runPrepare({ status: 'draft', dueDate: new Date('2026-10-19T00:00:00.000Z') });

        await expect(service.issue(ID)).resolves.toBeDefined();
      });

      // The issue date becomes today, so an earlier due date would make an invoice due before it exists.
      it('refuses to issue a draft whose due date has already passed, without taking a number', async () => {
        runPrepare({ status: 'draft', dueDate: new Date('2026-10-18T00:00:00.000Z') });

        await expect(service.issue(ID)).rejects.toThrow(
          new UnprocessableEntityException('The due date (2026-10-18) is before today; change it before issuing.'),
        );
        expect(numbering.next).not.toHaveBeenCalled();
      });
    });

    it('cancels only from issued or overdue', async () => {
      repository.transitionStatus.mockResolvedValue({
        outcome: 'transitioned',
        invoice: buildFullInvoiceDoc('cancelled'),
        from: 'overdue',
      });

      await service.cancel(ID);

      expect(repository.transitionStatus).toHaveBeenCalledWith(ID, ['issued', 'overdue'], 'cancelled', {
        inTransaction: expect.any(Function),
      });
    });

    // payment expires the invoice's open checkout session when it sees this event.
    it("enqueues invoice.cancelled inside the cancellation's transaction", async () => {
      jest.useFakeTimers({ now: new Date('2026-10-19T10:00:00.000Z') });
      try {
        const cancelled = buildFullInvoiceDoc('cancelled');
        repository.transitionStatus.mockImplementation(async (_id, _from, _to, options) => {
          await options?.inTransaction?.(cancelled, SESSION as never);
          return { outcome: 'transitioned', invoice: cancelled, from: 'issued' };
        });

        await service.cancel(ID);

        expect(eventsProducer.enqueueCancelled).toHaveBeenCalledWith(SESSION, {
          invoiceId: ID,
          invoiceNumber: 'INV-0001',
          cancelledAt: '2026-10-19T10:00:00.000Z',
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('enqueues no event when cancelling an already-cancelled invoice (idempotent no-op)', async () => {
      repository.transitionStatus.mockResolvedValue({ outcome: 'rejected', invoice: buildFullInvoiceDoc('cancelled') });

      await service.cancel(ID);

      expect(eventsProducer.enqueueCancelled).not.toHaveBeenCalled();
    });

    it('refuses an illegal transition with a 409 naming the current status', async () => {
      repository.transitionStatus.mockResolvedValue({ outcome: 'rejected', invoice: buildFullInvoiceDoc('cancelled') });

      await expect(service.markPaid(ID)).rejects.toThrow(
        new ConflictException('Cannot mark as paid an invoice that is cancelled.'),
      );
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    // Stripe redelivers webhooks; a retried issue/cancel from a client must not fail either.
    it('treats a transition to the status the invoice already has as an idempotent no-op', async () => {
      const paid = buildFullInvoiceDoc('paid');
      repository.transitionStatus.mockResolvedValue({ outcome: 'rejected', invoice: paid });

      await expect(service.markPaid(ID)).resolves.toEqual(paid.toJSON());
      expect(auditLog.record).not.toHaveBeenCalled();
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing invoice', async () => {
      repository.transitionStatus.mockResolvedValue({ outcome: 'not_found' });

      await expect(service.cancel(ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('PDFs: generate, download, send', () => {
    const KEY = 'invoices/0b1c/invoice-INV-0001.pdf';
    const DOWNLOAD = {
      url: 'https://s3.test/signed?X-Amz-Signature=abc',
      expiresAt: '2026-10-19T10:05:00.000Z',
      fileName: 'invoice-INV-0001.pdf',
    };

    beforeEach(() => {
      pdfGeneratorClient.generateInvoicePdf.mockResolvedValue({
        base64: 'JVBERg==',
        contentType: 'application/pdf',
        fileName: 'invoice-INV-0001.pdf',
      });
      mediaClient.uploadFile.mockResolvedValue({ key: KEY });
      mediaClient.getDownloadUrl.mockResolvedValue(DOWNLOAD);
      // Like the real repository: stores the key, then runs the hook in the same transaction.
      repository.setPdfMetadata.mockImplementation(async (_id, pdfKey, _at, inTransaction) => {
        const stored = { ...buildFullInvoiceDoc('issued'), pdfKey } as never;
        await inTransaction?.(stored, SESSION as never);
        return stored;
      });
    });

    it('generatePdf stores the PDF privately, returns a short-lived link, and never emails the client', async () => {
      repository.findOne.mockResolvedValue(buildFullInvoiceDoc('draft'));

      const result = await service.generatePdf(ID);

      expect(pdfGeneratorClient.generateInvoicePdf).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceNumber: 'INV-0001' }),
      );
      expect(repository.setPdfMetadata).toHaveBeenCalledWith(ID, KEY, expect.any(Date), undefined);
      expect(mediaClient.getDownloadUrl).toHaveBeenCalledWith({ key: KEY, fileName: 'invoice-INV-0001.pdf' });
      expect(result).toEqual(DOWNLOAD);
      expect(eventsProducer.enqueueSent).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'GENERATE_PDF' }));
    });

    describe('getPdfDownloadUrl', () => {
      it('signs a fresh link for the stored key, named after its file', async () => {
        repository.findOne.mockResolvedValue({ ...buildFullInvoiceDoc('issued'), pdfKey: KEY } as never);

        await expect(service.getPdfDownloadUrl(ID)).resolves.toEqual(DOWNLOAD);

        expect(mediaClient.getDownloadUrl).toHaveBeenCalledWith({ key: KEY, fileName: 'invoice-INV-0001.pdf' });
      });

      it('is a 404 when no PDF has been generated yet', async () => {
        repository.findOne.mockResolvedValue(buildFullInvoiceDoc('draft'));

        await expect(service.getPdfDownloadUrl(ID)).rejects.toThrow(
          new NotFoundException(`No PDF has been generated for invoice "${ID}" yet.`),
        );
        expect(mediaClient.getDownloadUrl).not.toHaveBeenCalled();
      });

      it('is a 404 for a missing invoice', async () => {
        repository.findOne.mockResolvedValue(null);

        await expect(service.getPdfDownloadUrl(ID)).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    it("send issues a draft, then enqueues invoice.sent (with the key, never a URL) in the PDF's transaction", async () => {
      repository.findOne.mockResolvedValue(buildFullInvoiceDoc('draft'));
      repository.transitionStatus.mockResolvedValue({
        outcome: 'transitioned',
        invoice: buildFullInvoiceDoc('issued'),
        from: 'draft',
      });

      const result = await service.send(ID);

      expect(repository.transitionStatus).toHaveBeenCalledWith(ID, ['draft'], 'issued', {
        prepare: expect.any(Function),
      });
      expect(pdfGeneratorClient.generateInvoicePdf).toHaveBeenCalledWith(expect.objectContaining({ status: 'issued' }));
      expect(repository.setPdfMetadata).toHaveBeenCalledWith(ID, KEY, expect.any(Date), expect.any(Function));
      expect(eventsProducer.enqueueSent).toHaveBeenCalledWith(SESSION, {
        invoiceId: ID,
        invoiceNumber: 'INV-0001',
        clientName: 'Acme Corp',
        clientEmail: 'billing@acme.test',
        pdfKey: KEY,
        fileName: 'invoice-INV-0001.pdf',
        currency: 'EUR',
        total: 120,
        issueDate: '2026-10-01T00:00:00.000Z',
        dueDate: undefined,
      });
      expect(result).toEqual({ invoice: expect.objectContaining({ status: 'issued' }), pdf: DOWNLOAD });
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'SEND' }));
    });

    // The point of the outbox: no event without the commit, no commit without the event.
    it('fails the send when the event cannot be enqueued (the transaction rolls back)', async () => {
      repository.findOne.mockResolvedValue(buildFullInvoiceDoc('issued'));
      eventsProducer.enqueueSent.mockRejectedValue(new Error('outbox write failed'));

      await expect(service.send(ID)).rejects.toThrow('outbox write failed');
      expect(auditLog.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'SEND' }));
    });

    it('re-sends an overdue invoice (a reminder) without changing its status', async () => {
      repository.findOne.mockResolvedValue(buildFullInvoiceDoc('overdue'));

      await service.send(ID);

      expect(repository.transitionStatus).not.toHaveBeenCalled();
      expect(eventsProducer.enqueueSent).toHaveBeenCalled();
    });

    it.each([['paid'], ['cancelled']])('refuses to send a %s invoice, before rendering anything', async (status) => {
      repository.findOne.mockResolvedValue(buildFullInvoiceDoc(status));

      await expect(service.send(ID)).rejects.toThrow(
        new ConflictException(`Cannot send an invoice that is ${status}.`),
      );
      expect(pdfGeneratorClient.generateInvoicePdf).not.toHaveBeenCalled();
      expect(eventsProducer.enqueueSent).not.toHaveBeenCalled();
    });

    // Drafts are unnumbered until issued; their preview must not look like a numbered legal document.
    it('renders an unnumbered draft as DRAFT', async () => {
      const draft = buildFullInvoiceDoc('draft');
      repository.findOne.mockResolvedValue({ ...draft, invoiceNumber: undefined } as never);

      await service.generatePdf(ID);

      expect(pdfGeneratorClient.generateInvoicePdf).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceNumber: 'DRAFT', status: 'draft' }),
      );
    });

    it('does not email the client if rendering fails', async () => {
      repository.findOne.mockResolvedValue(buildFullInvoiceDoc('issued'));
      pdfGeneratorClient.generateInvoicePdf.mockRejectedValue(new Error('chromium crashed'));

      await expect(service.send(ID)).rejects.toThrow('chromium crashed');
      expect(eventsProducer.enqueueSent).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft-deletes, invalidates cache, bumps the list version, and records an audit entry', async () => {
      const previous = buildInvoiceDoc({ id: 'invoice-1' });
      repository.findOne.mockResolvedValue(previous);
      repository.remove.mockResolvedValue(previous);

      const result = await service.remove('507f1f77bcf86cd799439011', 2);

      expect(result).toEqual({ id: '507f1f77bcf86cd799439011', deleted: true });
      expect(cacheManager.del).toHaveBeenCalled();
      expect(redis.incr).toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE' }));
    });

    it('throws NotFoundException when there is nothing left to delete', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.remove.mockResolvedValue(null);

      await expect(service.remove('507f1f77bcf86cd799439011')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
