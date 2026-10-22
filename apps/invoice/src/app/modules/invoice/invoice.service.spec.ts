import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
import type { ProductResponse } from '@libs/interfaces/gateway';
import { InvoiceService, documentFormat } from './invoice.service';
import { presentInvoice } from './invoice-presenter';
import { IInvoiceRepository, TransitionOptions } from './invoice.repository.interface';

type MockCache = { get: jest.Mock; set: jest.Mock; del: jest.Mock };
type MockRedis = { get: jest.Mock; incr: jest.Mock };
type MockAuditLog = { record: jest.Mock };
type MockPdfGeneratorClient = { generateInvoicePdf: jest.Mock };
type MockMediaClient = { uploadFile: jest.Mock; getDownloadUrl: jest.Mock };
type MockEventsProducer = {
  enqueueDemo: jest.Mock;
  enqueueSent: jest.Mock;
  enqueueCancelled: jest.Mock;
  enqueueReminder: jest.Mock;
};
type MockCustomers = { snapshotOf: jest.Mock };
type MockNumbering = { prepare: jest.Mock; next: jest.Mock };
type MockProducts = { findMany: jest.Mock };

// Stands in for the transaction's ClientSession: events must be enqueued with exactly this object.
const SESSION = { id: 'txn-session' };

// Like a Mongoose document: fields readable as properties and through toJSON(), stored as minor
// units (the presenter turns them into the API's decimals).
const buildInvoiceDoc = (overrides: Record<string, unknown> = {}) => {
  const fields = {
    id: overrides['id'] ?? 'invoice-1',
    invoiceNumber: 'INV-0001',
    currency: 'USD',
    items: [],
    netMinor: 0,
    sdMinor: 0,
    vatMinor: 0,
    totalMinor: 0,
    ...overrides,
  };
  return { ...fields, _id: { toString: () => fields.id }, toJSON: () => fields } as unknown as Awaited<
    ReturnType<IInvoiceRepository['create']>
  >;
};

const ID = '507f1f77bcf86cd799439011';
const CLIENT = { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Main St' };
const ISSUER = { name: 'Acme Ltd.', bin: null, address: null, authorizedSignatory: null };
const SETTINGS = { invoicePrefix: 'ACME', reminderOffsetsDays: [1, 7, 14], timeZone: 'UTC', issuer: ISSUER };
const PREPARED = { organizationId: ORG, prefix: 'ACME', year: 2026, settings: SETTINGS };

// A free-form line as requested, and as the service stores it.
const ITEMS = [{ catalogId: 'sku-1', name: 'Widget', quantity: 2, unitPrice: 10.5, vatRate: 15 }];
const STORED_ITEMS = [
  { catalogId: 'sku-1', name: 'Widget', quantity: 2, unitPriceMinor: 1050, vatRate: 15, sdRate: 0 },
];
const NEW_INVOICE = { client: CLIENT, currency: 'USD', items: ITEMS };

const PRODUCT_ID = '3f1b3c9a-7e3d-4a2c-9c1e-6b1a4a9c2f10';
const product = (overrides: Partial<ProductResponse> = {}): ProductResponse => ({
  id: PRODUCT_ID,
  sku: 'AC-1',
  name: 'Air conditioner',
  unitPrice: 100_000,
  currency: 'BDT',
  vatRate: 15,
  sdRate: 20,
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

// A document with everything PDF rendering and the invoice.sent event read.
const buildFullInvoiceDoc = (status: string) => {
  const fields = {
    id: ID,
    invoiceNumber: 'INV-0001',
    status,
    client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Main St' },
    items: [
      {
        catalogId: 'sku-1',
        name: 'Widget',
        quantity: 1,
        unitPriceMinor: 10_000,
        vatRate: 20,
        sdRate: 0,
        netMinor: 10_000,
        sdMinor: 0,
        vatMinor: 2000,
        totalMinor: 12_000,
      },
    ],
    currency: 'EUR',
    issueDate: new Date('2026-10-01T00:00:00.000Z'),
    dueDate: undefined,
    notes: undefined,
    netMinor: 10_000,
    sdMinor: 0,
    vatMinor: 2000,
    totalMinor: 12_000,
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
  let settings: { current: jest.Mock };
  let products: MockProducts;
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
      findPastDueIssued: jest.fn(),
      findDueReminders: jest.fn(),
      advanceReminder: jest.fn(),
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
      enqueueReminder: jest.fn().mockResolvedValue('evt'),
    };
    settings = { current: jest.fn().mockResolvedValue(SETTINGS) };
    customers = { snapshotOf: jest.fn() };
    products = { findMany: jest.fn().mockResolvedValue([]) };
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
      settings as never,
      products as never,
    );
  });

  describe('create', () => {
    it('persists, bumps the list version, and records an audit entry', async () => {
      const created = buildInvoiceDoc({ id: 'invoice-1' });
      repository.create.mockResolvedValue(created);

      const result = await service.create(NEW_INVOICE as never);

      expect(result).toEqual(presentInvoice(created.toJSON()));
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

      await service.create(NEW_INVOICE as never);

      expect(eventsProducer.enqueueDemo).toHaveBeenCalledWith(SESSION, 'invoice-1');
    });

    // The invoice keeps its own copy: later edits to the customer never change it.
    it("bills a customer by snapshotting the customer's current details onto the invoice", async () => {
      customers.snapshotOf.mockResolvedValue(CLIENT);
      repository.create.mockResolvedValue(buildInvoiceDoc());

      await service.create({ customerId: 'cust-1', currency: 'USD', items: ITEMS } as never);

      expect(customers.snapshotOf).toHaveBeenCalledWith('cust-1');
      expect(repository.create).toHaveBeenCalledWith(
        { currency: 'USD', items: STORED_ITEMS, client: CLIENT, customerId: 'cust-1' },
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

      await expect(service.create(NEW_INVOICE as never)).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rethrows unrecognized errors as-is', async () => {
      const unexpected = new Error('boom');
      repository.create.mockRejectedValue(unexpected);

      await expect(service.create(NEW_INVOICE as never)).rejects.toBe(unexpected);
    });
  });

  describe('line items', () => {
    it('stores free-form lines in minor units without asking product', async () => {
      repository.create.mockResolvedValue(buildInvoiceDoc());

      await service.create(NEW_INVOICE as never);

      expect(products.findMany).not.toHaveBeenCalled();
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ items: STORED_ITEMS }),
        expect.any(Function),
      );
    });

    it("fills catalog lines from the organization's products, in one lookup for every line", async () => {
      products.findMany.mockResolvedValue([product()]);
      repository.create.mockResolvedValue(buildInvoiceDoc());

      await service.create({
        client: CLIENT,
        currency: 'BDT',
        items: [
          { productId: PRODUCT_ID, quantity: 1 },
          { productId: PRODUCT_ID, quantity: 3 },
        ],
      } as never);

      expect(products.findMany).toHaveBeenCalledTimes(1);
      expect(products.findMany).toHaveBeenCalledWith([PRODUCT_ID]);
      const line = {
        productId: PRODUCT_ID,
        catalogId: 'AC-1',
        name: 'Air conditioner',
        unitPriceMinor: 10_000_000,
        vatRate: 15,
        sdRate: 20,
      };
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            { ...line, quantity: 1 },
            { ...line, quantity: 3 },
          ],
        }),
        expect.any(Function),
      );
    });

    // product only returns the caller organization's products: another organization's id is absent.
    it.each([
      ['missing (or in another organization)', [], `items[0]: product "${PRODUCT_ID}" was not found.`],
      ['inactive', [product({ isActive: false })], 'items[0]: product "AC-1" is inactive.'],
      [
        'priced in another currency',
        [product({ currency: 'USD' })],
        'items[0]: product "AC-1" is priced in USD, the invoice in BDT.',
      ],
    ])('refuses a catalog line whose product is %s with a 422, writing nothing', async (_label, found, message) => {
      products.findMany.mockResolvedValue(found);

      await expect(
        service.create({ client: CLIENT, currency: 'BDT', items: [{ productId: PRODUCT_ID, quantity: 1 }] } as never),
      ).rejects.toThrow(new UnprocessableEntityException(message));
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('refuses a price finer than the currency allows with a 422', async () => {
      await expect(
        service.create({ ...NEW_INVOICE, items: [{ ...ITEMS[0], unitPrice: 10.005 }] } as never),
      ).rejects.toThrow(new UnprocessableEntityException('items[0]: 10.005 USD has more than 2 decimal places.'));
      expect(repository.create).not.toHaveBeenCalled();
    });

    // Re-checked in the service: RPC payloads skip DTO validation.
    it.each([
      ['no items', []],
      ['more than 500 items', Array.from({ length: 501 }, () => ITEMS[0])],
      ['items that are not a list', 'nope'],
    ])('refuses %s with a 422', async (_label, items) => {
      await expect(service.create({ ...NEW_INVOICE, items } as never)).rejects.toThrow(
        new UnprocessableEntityException('An invoice needs between 1 and 500 items.'),
      );
    });

    it('update re-resolves sent items in the currency the invoice will have', async () => {
      repository.findOne.mockResolvedValue(buildInvoiceDoc({ currency: 'USD' }));
      repository.update.mockResolvedValue(buildInvoiceDoc({ currency: 'BDT' }));
      products.findMany.mockResolvedValue([product()]);

      await service.update(ID, { currency: 'BDT', items: [{ productId: PRODUCT_ID, quantity: 1 }] }, 4);

      expect(repository.update).toHaveBeenCalledWith(
        ID,
        { currency: 'BDT', items: [expect.objectContaining({ productId: PRODUCT_ID, unitPriceMinor: 10_000_000 })] },
        4,
      );
    });

    it('update without items leaves the lines alone', async () => {
      repository.findOne.mockResolvedValue(buildInvoiceDoc());
      repository.update.mockResolvedValue(buildInvoiceDoc({ notes: 'n' }));

      await service.update(ID, { notes: 'n' });

      expect(repository.update).toHaveBeenCalledWith(ID, { notes: 'n' }, undefined);
      expect(products.findMany).not.toHaveBeenCalled();
    });

    // 1,500 BDT is not 1,500 USD: prices are restated, never silently reinterpreted.
    it('refuses a currency change without items with a 422', async () => {
      repository.findOne.mockResolvedValue(buildInvoiceDoc({ currency: 'BDT' }));

      await expect(service.update(ID, { currency: 'USD' })).rejects.toThrow(
        new UnprocessableEntityException(
          'Changing the currency from BDT to USD requires sending the items in USD too.',
        ),
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('presents stored minor units as the decimals the API has always returned', async () => {
      const stored = buildInvoiceDoc({
        currency: 'BDT',
        items: [
          {
            productId: PRODUCT_ID,
            catalogId: 'AC-1',
            name: 'Air conditioner',
            quantity: 10,
            unitPriceMinor: 10_000_050,
            vatRate: 15,
            sdRate: 20,
            netMinor: 100_000_500,
            sdMinor: 20_000_100,
            vatMinor: 18_000_090,
            totalMinor: 138_000_690,
          },
        ],
        netMinor: 100_000_500,
        sdMinor: 20_000_100,
        vatMinor: 18_000_090,
        totalMinor: 138_000_690,
      });
      repository.findOne.mockResolvedValue(stored);
      cacheManager.get.mockResolvedValue(undefined);

      const result = await service.findOne(ID);

      expect(result.items).toEqual([
        {
          productId: PRODUCT_ID,
          catalogId: 'AC-1',
          name: 'Air conditioner',
          quantity: 10,
          unitPrice: 100_000.5,
          vatRate: 15,
          sdRate: 20,
          net: 1_000_005,
          sd: 200_001,
          vat: 180_000.9,
          total: 1_380_006.9,
        },
      ]);
      expect(result).toMatchObject({ subtotal: 1_000_005, sdTotal: 200_001, vatTotal: 180_000.9, total: 1_380_006.9 });
      expect(result).not.toHaveProperty('totalMinor');
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

      expect(result.items).toEqual([presentInvoice(doc.toJSON())]);
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

      expect(result).toEqual(presentInvoice(doc.toJSON()));
      expect(cacheManager.get).toHaveBeenCalledWith(`svc:org:${ORG}:invoice:one:${ID}`);
      expect(cacheManager.set).toHaveBeenCalledWith(
        `svc:org:${ORG}:invoice:one:${ID}`,
        presentInvoice(doc.toJSON()),
        30_000,
      );
    });
  });

  describe('update', () => {
    it('invalidates the entity cache, bumps the list version, and records an audit entry', async () => {
      const previous = buildInvoiceDoc({ id: 'invoice-1' });
      const updated = buildInvoiceDoc({ id: 'invoice-1', invoiceNumber: 'INV-0002' });
      repository.findOne.mockResolvedValue(previous);
      repository.update.mockResolvedValue(updated);

      const result = await service.update('507f1f77bcf86cd799439011', {}, 3);

      expect(result).toEqual(presentInvoice(updated.toJSON()));
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
      expect(result).toEqual(presentInvoice(issued.toJSON()));
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
        // The seller as it is right now: the issued tax invoice keeps saying this.
        expect(extra).toEqual({
          invoiceNumber: 'ACME-2026-000007',
          issueDate: NOW,
          seller: { name: 'Acme Ltd.', timeZone: 'UTC' },
        });
      });

      it("snapshots a VAT-registered seller's BIN, address, signatory and time zone", async () => {
        numbering.prepare.mockResolvedValue({
          ...PREPARED,
          settings: {
            ...SETTINGS,
            timeZone: 'Asia/Dhaka',
            issuer: {
              name: 'Acme Ltd.',
              bin: '0012345670101',
              address: 'Road 8, Dhaka',
              authorizedSignatory: { name: 'Rahim Uddin', designation: 'Accounts Manager' },
            },
          },
        });
        runPrepare({ status: 'draft' });

        await service.issue(ID);

        const extra = await (repository.transitionStatus.mock.calls[0][3] as TransitionOptions).prepare?.(
          {} as never,
          SESSION as never,
        );
        expect(extra?.['seller']).toEqual({
          name: 'Acme Ltd.',
          bin: '0012345670101',
          address: 'Road 8, Dhaka',
          authorizedSignatory: { name: 'Rahim Uddin', designation: 'Accounts Manager' },
          timeZone: 'Asia/Dhaka',
        });
      });

      // A user-access from before tax identities can't name the issuer: no seller block, as before.
      it('records no seller when the organization has no name to give', async () => {
        numbering.prepare.mockResolvedValue({
          ...PREPARED,
          settings: { ...SETTINGS, issuer: { ...ISSUER, name: '' } },
        });
        runPrepare({ status: 'draft' });

        await service.issue(ID);

        const extra = await (repository.transitionStatus.mock.calls[0][3] as TransitionOptions).prepare?.(
          {} as never,
          SESSION as never,
        );
        expect(extra).not.toHaveProperty('seller');
      });

      // 20:00 UTC on 19 Oct is 02:00 on 20 Oct in Dhaka: a draft due on the 19th is already late there.
      it("judges 'today' on the organization's clock", async () => {
        jest.setSystemTime(new Date('2026-10-19T20:00:00.000Z'));
        numbering.prepare.mockResolvedValue({ ...PREPARED, settings: { ...SETTINGS, timeZone: 'Asia/Dhaka' } });
        runPrepare({ status: 'draft', dueDate: new Date('2026-10-19T00:00:00.000Z') });

        await expect(service.issue(ID)).rejects.toThrow(
          new UnprocessableEntityException('The due date (2026-10-19) is before today; change it before issuing.'),
        );

        numbering.prepare.mockResolvedValue(PREPARED);
        await expect(service.issue(ID)).resolves.toBeDefined();
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

      await expect(service.markPaid(ID)).resolves.toEqual(presentInvoice(paid.toJSON()));
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

      // Exact minor units: the renderer formats them for the currency.
      expect(pdfGeneratorClient.generateInvoicePdf).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceNumber: 'INV-0001',
          currency: 'EUR',
          items: [expect.objectContaining({ unitPriceMinor: 10_000, sdRate: 0, sdMinor: 0, totalMinor: 12_000 })],
          netMinor: 10_000,
          sdMinor: 0,
          vatMinor: 2000,
          totalMinor: 12_000,
        }),
      );
      expect(repository.setPdfMetadata).toHaveBeenCalledWith(ID, KEY, expect.any(Date), undefined);
      expect(mediaClient.getDownloadUrl).toHaveBeenCalledWith({ key: KEY, fileName: 'invoice-INV-0001.pdf' });
      expect(result).toEqual(DOWNLOAD);
      expect(eventsProducer.enqueueSent).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'GENERATE_PDF' }));
    });

    describe('document format and seller', () => {
      const MUSHAK_SELLER = {
        name: 'Acme Ltd.',
        bin: '0012345670101',
        address: 'Road 8, Dhaka',
        authorizedSignatory: { name: 'Rahim Uddin', designation: 'Accounts Manager' },
        timeZone: 'Asia/Dhaka',
      };
      const bdtInvoice = (status: string, fields: Record<string, unknown> = {}) =>
        ({
          ...buildFullInvoiceDoc(status),
          currency: 'BDT',
          client: {
            name: 'Dhaka Traders Ltd',
            email: 'ap@dhaka.test',
            address: 'Tejgaon, Dhaka',
            bin: '0098765430202',
          },
          items: [{ ...buildFullInvoiceDoc(status).items[0], unit: 'pcs' }],
          ...fields,
        }) as never;

      it('renders an issued BDT invoice of a VAT-registered seller as Mushak-6.3, from its snapshot', async () => {
        repository.findOne.mockResolvedValue(bdtInvoice('issued', { seller: MUSHAK_SELLER }));

        await service.generatePdf(ID);

        expect(pdfGeneratorClient.generateInvoicePdf).toHaveBeenCalledWith(
          expect.objectContaining({
            format: 'mushak-6.3',
            seller: {
              name: 'Acme Ltd.',
              bin: '0012345670101',
              address: 'Road 8, Dhaka',
              authorizedSignatory: { name: 'Rahim Uddin', designation: 'Accounts Manager' },
            },
            timeZone: 'Asia/Dhaka',
            client: expect.objectContaining({ bin: '0098765430202' }),
            items: [expect.objectContaining({ unit: 'pcs' })],
          }),
        );
        // The snapshot is the record: the organization's current settings aren't consulted.
        expect(settings.current).not.toHaveBeenCalled();
      });

      it("renders a draft with the organization's current details", async () => {
        settings.current.mockResolvedValue({
          ...SETTINGS,
          timeZone: 'Asia/Dhaka',
          issuer: { name: 'Acme Ltd.', bin: '0012345670101', address: 'Road 8, Dhaka', authorizedSignatory: null },
        });
        repository.findOne.mockResolvedValue(bdtInvoice('draft'));

        await service.generatePdf(ID);

        expect(pdfGeneratorClient.generateInvoicePdf).toHaveBeenCalledWith(
          expect.objectContaining({
            format: 'mushak-6.3',
            invoiceNumber: 'INV-0001',
            seller: { name: 'Acme Ltd.', bin: '0012345670101', address: 'Road 8, Dhaka' },
            timeZone: 'Asia/Dhaka',
          }),
        );
      });

      // Issued before seller snapshots existed: today's BIN must not turn it into a tax challan retroactively.
      it('never borrows current details for an issued invoice that has no snapshot', async () => {
        settings.current.mockResolvedValue({
          ...SETTINGS,
          issuer: { name: 'Acme Ltd.', bin: '0012345670101', address: 'Road 8, Dhaka', authorizedSignatory: null },
        });
        repository.findOne.mockResolvedValue(bdtInvoice('issued'));

        await service.generatePdf(ID);

        expect(pdfGeneratorClient.generateInvoicePdf).toHaveBeenCalledWith(
          expect.objectContaining({ format: 'standard', seller: undefined, timeZone: 'UTC' }),
        );
        expect(settings.current).not.toHaveBeenCalled();
      });

      it('keeps the standard layout without a BIN, or for another currency', async () => {
        repository.findOne.mockResolvedValue(bdtInvoice('issued', { seller: { name: 'Acme Ltd.', timeZone: 'UTC' } }));
        await service.generatePdf(ID);
        expect(pdfGeneratorClient.generateInvoicePdf).toHaveBeenLastCalledWith(
          expect.objectContaining({ format: 'standard', timeZone: 'UTC' }),
        );

        repository.findOne.mockResolvedValue({ ...buildFullInvoiceDoc('issued'), seller: MUSHAK_SELLER } as never);
        await service.generatePdf(ID);
        expect(pdfGeneratorClient.generateInvoicePdf).toHaveBeenLastCalledWith(
          expect.objectContaining({ format: 'standard', currency: 'EUR' }),
        );
      });
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
        totalMinor: 12_000,
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

  describe('overdue scheduler work', () => {
    const DUE = new Date('2026-10-10T00:00:00.000Z');
    const NOW = new Date('2026-10-11T00:05:00.000Z'); // first overdue day
    const DAY1 = new Date('2026-10-11T00:00:00.000Z');
    const DAY7 = new Date('2026-10-17T00:00:00.000Z');
    const KEY = 'orgs/o/invoices/u/invoice-INV-0001.pdf';
    const overdue = (overrides: Record<string, unknown> = {}) =>
      ({
        ...buildFullInvoiceDoc('overdue'),
        dueDate: DUE,
        nextReminderAt: DAY1,
        remindersSent: 0,
        pdfKey: KEY,
        ...overrides,
      }) as never;

    describe('markOverdue', () => {
      it('moves issued -> overdue, scheduling the first reminder from the organization schedule', async () => {
        repository.transitionStatus.mockImplementation(async (_id, _from, _to, options) => {
          const extra = await options?.prepare?.({ dueDate: DUE } as never, SESSION as never);
          expect(extra).toEqual({ nextReminderAt: DAY1 });
          return { outcome: 'transitioned', invoice: overdue(), from: 'issued' };
        });

        await expect(service.markOverdue(ID, NOW)).resolves.toBe(true);

        expect(repository.transitionStatus).toHaveBeenCalledWith(ID, ['issued'], 'overdue', expect.anything());
        expect(auditLog.record).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'STATUS_CHANGE', diff: { status: { from: 'issued', to: 'overdue' } } }),
        );
      });

      it('schedules no reminder when the organization turned reminders off', async () => {
        settings.current.mockResolvedValue({ invoicePrefix: 'ACME', reminderOffsetsDays: [] });
        repository.transitionStatus.mockImplementation(async (_id, _from, _to, options) => {
          expect(await options?.prepare?.({ dueDate: DUE } as never, SESSION as never)).toEqual({
            nextReminderAt: null,
          });
          return { outcome: 'transitioned', invoice: overdue(), from: 'issued' };
        });

        await service.markOverdue(ID, NOW);
      });

      // A payment or cancellation that landed first simply wins.
      it('does nothing, without error or audit, when the invoice is no longer issued', async () => {
        repository.transitionStatus.mockResolvedValue({ outcome: 'rejected', invoice: buildFullInvoiceDoc('paid') });

        await expect(service.markOverdue(ID, NOW)).resolves.toBe(false);
        expect(auditLog.record).not.toHaveBeenCalled();
      });
    });

    describe('sendDueReminder', () => {
      it('emails the due reminder in the transaction that records it, and schedules the next', async () => {
        repository.findOne.mockResolvedValue(overdue());
        repository.advanceReminder.mockImplementation(async (_id, _at, _next, sent) => {
          const stored = overdue({ remindersSent: 1 });
          await sent?.inTransaction?.(stored, SESSION as never);
          return stored;
        });

        await expect(service.sendDueReminder(ID, NOW)).resolves.toBe('sent');

        expect(repository.advanceReminder).toHaveBeenCalledWith(ID, DAY1, DAY7, expect.objectContaining({ at: NOW }));
        expect(eventsProducer.enqueueReminder).toHaveBeenCalledWith(SESSION, {
          invoiceId: ID,
          invoiceNumber: 'INV-0001',
          clientName: 'Acme Corp',
          clientEmail: 'billing@acme.test',
          pdfKey: KEY,
          fileName: 'invoice-INV-0001.pdf',
          currency: 'EUR',
          totalMinor: 12_000,
          total: 120,
          dueDate: DUE.toISOString(),
          daysOverdue: 1,
          reminderNumber: 1,
        });
        expect(auditLog.record).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'REMINDER', diff: { remindersSent: { from: 0, to: 1 } } }),
        );
        expect(pdfGeneratorClient.generateInvoicePdf).not.toHaveBeenCalled();
      });

      // nextReminderAt edited to just before an offset that was already used: no immediate repeat.
      it('schedules the next reminder after the moment it sends one, whatever nextReminderAt held', async () => {
        const oddlyEarly = new Date('2026-10-10T23:59:00.000Z'); // before the day-1 slot
        repository.findOne.mockResolvedValue(overdue({ nextReminderAt: oddlyEarly }));
        repository.advanceReminder.mockResolvedValue(overdue({ remindersSent: 1 }));

        await service.sendDueReminder(ID, NOW);

        expect(repository.advanceReminder).toHaveBeenCalledWith(ID, oddlyEarly, DAY7, expect.anything());
      });

      it('skips a reminder missed by more than a day instead of sending it late', async () => {
        const late = new Date('2026-10-13T09:00:00.000Z');
        repository.findOne.mockResolvedValue(overdue());
        repository.advanceReminder.mockResolvedValue(overdue({ nextReminderAt: DAY7 }));

        await expect(service.sendDueReminder(ID, late)).resolves.toBe('skipped');

        expect(repository.advanceReminder).toHaveBeenCalledWith(ID, DAY1, DAY7, null);
        expect(eventsProducer.enqueueReminder).not.toHaveBeenCalled();
      });

      it('renders the PDF first when the invoice was issued without one', async () => {
        repository.findOne.mockResolvedValue(overdue({ pdfKey: undefined }));
        pdfGeneratorClient.generateInvoicePdf.mockResolvedValue({
          base64: 'JVBERg==',
          contentType: 'application/pdf',
          fileName: 'invoice-INV-0001.pdf',
        });
        mediaClient.uploadFile.mockResolvedValue({ key: KEY });
        repository.setPdfMetadata.mockResolvedValue(overdue());
        repository.advanceReminder.mockImplementation(async (_id, _at, _next, sent) => {
          await sent?.inTransaction?.(overdue({ remindersSent: 1 }), SESSION as never);
          return overdue({ remindersSent: 1 });
        });

        await service.sendDueReminder(ID, NOW);

        expect(pdfGeneratorClient.generateInvoicePdf).toHaveBeenCalled();
        expect(eventsProducer.enqueueReminder).toHaveBeenCalledWith(SESSION, expect.objectContaining({ pdfKey: KEY }));
      });

      it.each([
        ['not due yet', overdue({ nextReminderAt: DAY7 })],
        ['no reminder scheduled', overdue({ nextReminderAt: null })],
        ['no longer overdue (paid)', overdue({ status: 'paid' })],
      ])('does nothing when %s', async (_label, invoice) => {
        repository.findOne.mockResolvedValue(invoice as never);

        await expect(service.sendDueReminder(ID, NOW)).resolves.toBe('none');
        expect(repository.advanceReminder).not.toHaveBeenCalled();
      });

      // Another pass (or replica) handled this reminder between our read and our write.
      it('does not audit or count a reminder another pass already handled', async () => {
        repository.findOne.mockResolvedValue(overdue());
        repository.advanceReminder.mockResolvedValue(null);

        await expect(service.sendDueReminder(ID, NOW)).resolves.toBe('none');
        expect(auditLog.record).not.toHaveBeenCalled();
      });
    });
  });
});

describe('documentFormat', () => {
  it.each([
    ['BDT', '0012345670101', 'mushak-6.3'],
    ['BDT', undefined, 'standard'],
    ['USD', '0012345670101', 'standard'],
  ] as const)('%s with BIN %s -> %s', (currency, bin, format) => {
    expect(documentFormat(currency, { bin })).toBe(format);
  });

  it('is standard without a seller', () => {
    expect(documentFormat('BDT', undefined)).toBe('standard');
  });
});
