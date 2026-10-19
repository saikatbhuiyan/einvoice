import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import { InvoiceService } from './invoice.service';
import { IInvoiceRepository } from './invoice.repository.interface';

type MockCache = { get: jest.Mock; set: jest.Mock; del: jest.Mock };
type MockRedis = { get: jest.Mock; incr: jest.Mock };
type MockAuditLog = { record: jest.Mock };
type MockPdfGeneratorClient = { generateInvoicePdf: jest.Mock };
type MockMediaClient = { uploadFile: jest.Mock };
type MockEventsProducer = { emitDemo: jest.Mock; emitSent: jest.Mock };

const buildInvoiceDoc = (overrides: Record<string, unknown> = {}) => {
  const base = {
    _id: { toString: () => overrides['id'] ?? 'invoice-1' },
    toJSON: () => ({ id: overrides['id'] ?? 'invoice-1', invoiceNumber: 'INV-0001', ...overrides }),
  };
  return base as unknown as Awaited<ReturnType<IInvoiceRepository['create']>>;
};

const ID = '507f1f77bcf86cd799439011';

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
    mediaClient = { uploadFile: jest.fn() };
    eventsProducer = { emitDemo: jest.fn(), emitSent: jest.fn() };

    service = new InvoiceService(
      repository,
      cacheManager as never,
      redis as never,
      auditLog as never,
      pdfGeneratorClient as never,
      mediaClient as never,
      eventsProducer as never,
    );
  });

  describe('create', () => {
    it('persists, bumps the list version, and records an audit entry', async () => {
      const created = buildInvoiceDoc({ id: 'invoice-1' });
      repository.create.mockResolvedValue(created);

      const result = await service.create({ invoiceNumber: 'INV-0001' } as never);

      expect(result).toEqual(created.toJSON());
      expect(redis.incr).toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'invoice', entityId: 'invoice-1' }),
      );
    });

    it('maps a duplicate invoiceNumber error to ConflictException', async () => {
      repository.create.mockRejectedValue({
        code: 11000,
        keyPattern: { invoiceNumber: 1 },
        keyValue: { invoiceNumber: 'INV-0001' },
      });

      await expect(service.create({ invoiceNumber: 'INV-0001' } as never)).rejects.toBeInstanceOf(ConflictException);
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

      await expect(service.create({ invoiceNumber: 'INV-0001' } as never)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('rethrows unrecognized errors as-is', async () => {
      const unexpected = new Error('boom');
      repository.create.mockRejectedValue(unexpected);

      await expect(service.create({ invoiceNumber: 'INV-0001' } as never)).rejects.toBe(unexpected);
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

    it('caches the response on a successful lookup', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      const doc = buildInvoiceDoc({ id: 'invoice-1' });
      repository.findOne.mockResolvedValue(doc);

      const result = await service.findOne('507f1f77bcf86cd799439011');

      expect(result).toEqual(doc.toJSON());
      expect(cacheManager.set).toHaveBeenCalled();
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

      expect(repository.transitionStatus).toHaveBeenCalledWith(ID, ['draft'], 'issued');
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

    it('cancels only from issued or overdue', async () => {
      repository.transitionStatus.mockResolvedValue({
        outcome: 'transitioned',
        invoice: buildFullInvoiceDoc('cancelled'),
        from: 'overdue',
      });

      await service.cancel(ID);

      expect(repository.transitionStatus).toHaveBeenCalledWith(ID, ['issued', 'overdue'], 'cancelled');
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

  describe('generatePdf and send', () => {
    beforeEach(() => {
      pdfGeneratorClient.generateInvoicePdf.mockResolvedValue({
        base64: 'JVBERg==',
        contentType: 'application/pdf',
        fileName: 'invoice-INV-0001.pdf',
      });
      mediaClient.uploadFile.mockResolvedValue({ url: 'https://s3.test/invoice-INV-0001.pdf' });
    });

    it('generatePdf renders and stores the PDF but never emails the client', async () => {
      repository.findOne.mockResolvedValue(buildFullInvoiceDoc('draft'));

      const result = await service.generatePdf(ID);

      expect(result).toEqual({ url: 'https://s3.test/invoice-INV-0001.pdf', fileName: 'invoice-INV-0001.pdf' });
      expect(repository.setPdfMetadata).toHaveBeenCalledWith(
        ID,
        'https://s3.test/invoice-INV-0001.pdf',
        expect.any(Date),
      );
      expect(eventsProducer.emitSent).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'GENERATE_PDF' }));
    });

    it('send issues a draft first, so the PDF and the email show it as issued', async () => {
      repository.findOne.mockResolvedValue(buildFullInvoiceDoc('draft'));
      repository.transitionStatus.mockResolvedValue({
        outcome: 'transitioned',
        invoice: buildFullInvoiceDoc('issued'),
        from: 'draft',
      });

      const result = await service.send(ID);

      expect(repository.transitionStatus).toHaveBeenCalledWith(ID, ['draft'], 'issued');
      expect(pdfGeneratorClient.generateInvoicePdf).toHaveBeenCalledWith(expect.objectContaining({ status: 'issued' }));
      expect(eventsProducer.emitSent).toHaveBeenCalledWith({
        invoiceId: ID,
        invoiceNumber: 'INV-0001',
        clientName: 'Acme Corp',
        clientEmail: 'billing@acme.test',
        pdfUrl: 'https://s3.test/invoice-INV-0001.pdf',
        fileName: 'invoice-INV-0001.pdf',
        currency: 'EUR',
        total: 120,
        issueDate: '2026-10-01T00:00:00.000Z',
        dueDate: undefined,
      });
      expect(result).toEqual({
        invoice: expect.objectContaining({ status: 'issued' }),
        pdfUrl: 'https://s3.test/invoice-INV-0001.pdf',
        fileName: 'invoice-INV-0001.pdf',
      });
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'SEND' }));
    });

    it('re-sends an overdue invoice (a reminder) without changing its status', async () => {
      repository.findOne.mockResolvedValue(buildFullInvoiceDoc('overdue'));

      await service.send(ID);

      expect(repository.transitionStatus).not.toHaveBeenCalled();
      expect(eventsProducer.emitSent).toHaveBeenCalled();
    });

    it.each(['paid', 'cancelled'])('refuses to send a %s invoice, before rendering anything', async (status) => {
      repository.findOne.mockResolvedValue(buildFullInvoiceDoc(status));

      await expect(service.send(ID)).rejects.toThrow(
        new ConflictException(`Cannot send an invoice that is ${status}.`),
      );
      expect(pdfGeneratorClient.generateInvoicePdf).not.toHaveBeenCalled();
      expect(eventsProducer.emitSent).not.toHaveBeenCalled();
    });

    it('does not email the client if rendering fails', async () => {
      repository.findOne.mockResolvedValue(buildFullInvoiceDoc('issued'));
      pdfGeneratorClient.generateInvoicePdf.mockRejectedValue(new Error('chromium crashed'));

      await expect(service.send(ID)).rejects.toThrow('chromium crashed');
      expect(eventsProducer.emitSent).not.toHaveBeenCalled();
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
