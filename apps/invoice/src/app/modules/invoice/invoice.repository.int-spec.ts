import { BadRequestException, ConflictException } from '@nestjs/common';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import mongoose, { type Connection } from 'mongoose';
import { InvoiceModelName, InvoiceSchema, type InvoiceModel } from '@libs/schemas';
import type { CreateInvoiceRequest } from '@libs/interfaces/gateway';
import { InvoiceRepository } from './invoice.repository';

/**
 * Integration test: InvoiceRepository against a real MongoDB. Concurrency control (version-checked
 * saves), unique indexes, and $regex behavior are all enforced by the database itself — a mocked
 * model can only assert that the repository *asked* for them.
 */
describe('InvoiceRepository against real MongoDB', () => {
  let container: StartedMongoDBContainer;
  let connection: Connection;
  let model: InvoiceModel;
  let repository: InvoiceRepository;
  let counter = 0;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:7').start();
    connection = await mongoose
      .createConnection(container.getConnectionString(), { directConnection: true, dbName: 'invoice_int' })
      .asPromise();
    model = connection.model(InvoiceModelName, InvoiceSchema) as unknown as InvoiceModel;
    // Unique indexes only exist once built; autoIndex builds them in the background.
    await model.init();
    repository = new InvoiceRepository(model, model);
  });

  afterAll(async () => {
    await connection?.close();
    await container?.stop();
  });

  beforeEach(() => model.deleteMany({}));

  const payload = (overrides: Partial<CreateInvoiceRequest> = {}): CreateInvoiceRequest =>
    ({
      invoiceNumber: `INT-${++counter}`,
      client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Main St' },
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 2, unitPrice: 50, vatRate: 10 }],
      currency: 'USD',
      ...overrides,
    }) as CreateInvoiceRequest;

  describe('create', () => {
    it('computes totals server-side via the pre-validate hook', async () => {
      const invoice = await repository.create(payload());

      expect(invoice.toObject()).toMatchObject({ subtotal: 100, vatTotal: 10, total: 110 });
    });

    it('enforces unique invoice numbers with a real index (E11000)', async () => {
      await repository.create(payload({ invoiceNumber: 'DUP-1' }));

      await expect(repository.create(payload({ invoiceNumber: 'DUP-1' }))).rejects.toMatchObject({ code: 11000 });
    });

    it('returns the existing invoice for a retried idempotency key', async () => {
      const first = await repository.create(payload({ idempotencyKey: 'retry-1' }));
      const retried = await repository.create(payload({ idempotencyKey: 'retry-1' }));

      expect(retried.id).toBe(first.id);
      expect(await model.countDocuments()).toBe(1);
    });

    // Two retries racing (a client timeout + automatic retry): both pass the "already exists?"
    // check, the unique index rejects one insert. Idempotency means *both* callers get the invoice.
    it('returns the same invoice to concurrent requests with the same idempotency key', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          repository.create(payload({ idempotencyKey: 'race-1', invoiceNumber: 'RACE-1' })),
        ),
      );

      expect(results.map((r) => r.status)).toEqual(Array(5).fill('fulfilled'));
      const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
      expect(ids.size).toBe(1);
      expect(await model.countDocuments()).toBe(1);
    });
  });

  describe('optimistic concurrency (If-Match)', () => {
    it('bumps the version on every update', async () => {
      const created = await repository.create(payload());

      const updated = await repository.update(created.id, { notes: 'v2' }, created.version);

      expect(updated?.version).toBe(created.version + 1);
    });

    it('rejects an update carrying a stale version with 409', async () => {
      const created = await repository.create(payload());
      await repository.update(created.id, { notes: 'first' }, created.version);

      await expect(repository.update(created.id, { notes: 'stale' }, created.version)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    // Both writers read the document at the same version before either saves. Exactly one may win;
    // the loser must get the same 409 a sequential stale write gets, not a raw VersionError (500).
    it('lets exactly one of two concurrent same-version updates win, and 409s the other', async () => {
      const created = await repository.create(payload());

      const results = await Promise.allSettled([
        repository.update(created.id, { notes: 'writer A' }, created.version),
        repository.update(created.id, { notes: 'writer B' }, created.version),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      expect((await model.findById(created.id))?.version).toBe(created.version + 1);
    });

    it('recomputes totals when items change on update', async () => {
      const created = await repository.create(payload());

      const updated = await repository.update(
        created.id,
        { items: [{ catalogId: 'sku-2', name: 'Gizmo', quantity: 1, unitPrice: 200, vatRate: 0 }] },
        created.version,
      );

      expect(updated?.toObject()).toMatchObject({ subtotal: 200, vatTotal: 0, total: 200 });
    });
  });

  describe('soft delete', () => {
    it('hides a removed invoice from reads but keeps the document', async () => {
      const created = await repository.create(payload());

      await repository.remove(created.id, created.version);

      expect(await repository.findOne(created.id)).toBeNull();
      expect((await repository.findAll({})).items).toHaveLength(0);
      expect(await model.findById(created.id)).toMatchObject({ deletedAt: expect.any(Date) });
    });
  });

  describe('lifecycle (status transitions and immutability)', () => {
    const issued = async () => {
      const created = await repository.create(payload());
      await repository.transitionStatus(created.id, ['draft'], 'issued');
      return created.id;
    };

    it('creates every invoice as a draft, even when the payload claims otherwise', async () => {
      const created = await repository.create({ ...payload(), status: 'paid' } as CreateInvoiceRequest);

      expect(created.status).toBe('draft');
    });

    it('transitions only from an allowed status, bumping the version', async () => {
      const created = await repository.create(payload());

      const result = await repository.transitionStatus(created.id, ['draft'], 'issued');

      expect(result).toMatchObject({ outcome: 'transitioned', from: 'draft' });
      const stored = await model.findById(created.id);
      expect(stored).toMatchObject({ status: 'issued', version: created.version + 1 });
    });

    it('rejects a transition from a status not in `from`, leaving the invoice untouched', async () => {
      const id = await issued();
      await repository.transitionStatus(id, ['issued', 'overdue'], 'cancelled');

      const result = await repository.transitionStatus(id, ['issued', 'overdue'], 'paid');

      expect(result).toMatchObject({ outcome: 'rejected', invoice: { status: 'cancelled' } });
      expect((await model.findById(id))?.status).toBe('cancelled');
    });

    // e.g. a Stripe webhook racing a user's cancel: exactly one of the two may land.
    it('lets exactly one of two concurrent conflicting transitions win', async () => {
      const id = await issued();

      const [paid, cancelled] = await Promise.all([
        repository.transitionStatus(id, ['issued', 'overdue'], 'paid'),
        repository.transitionStatus(id, ['issued', 'overdue'], 'cancelled'),
      ]);

      expect([paid.outcome, cancelled.outcome].sort()).toEqual(['rejected', 'transitioned']);
      const final = (await model.findById(id))?.status;
      expect(final).toBe(paid.outcome === 'transitioned' ? 'paid' : 'cancelled');
    });

    it('refuses to edit or delete an issued invoice with 409, leaving it unchanged', async () => {
      const id = await issued();

      await expect(repository.update(id, { notes: 'sneaky edit' })).rejects.toThrow(
        /Invoice is issued; only draft invoices can be edited/,
      );
      await expect(repository.remove(id)).rejects.toThrow(/Invoice is issued; only draft invoices can be deleted/);
      expect(await model.findById(id)).toMatchObject({ notes: undefined, deletedAt: null });
    });

    // The draft-edit read happens before the save; issuing in between must make that save fail,
    // which only works because transitionStatus bumps the version the save is conditioned on.
    it('fails an in-flight draft edit whose invoice was issued between its read and its save', async () => {
      const created = await repository.create(payload());
      const staleDraft = await model.findById(created.id);
      if (!staleDraft) throw new Error('seeded invoice not found');
      await repository.transitionStatus(created.id, ['draft'], 'issued');

      staleDraft.set({ notes: 'written over an issued invoice' });
      await expect(staleDraft.save()).rejects.toBeInstanceOf(mongoose.Error.VersionError);
      expect((await model.findById(created.id))?.notes).toBeUndefined();
    });
  });

  describe('listing', () => {
    it('starts cursor pagination with pagination=cursor and walks newest first without gaps or duplicates', async () => {
      const created: string[] = [];
      for (let i = 0; i < 5; i++) created.push((await repository.create(payload())).id);

      const first = await repository.findAll({ limit: 2, pagination: 'cursor' });
      expect(first.meta).toMatchObject({ mode: 'cursor', hasNextPage: true });

      const seen = first.items.map((item) => item.id);
      let cursor = (first.meta as { cursor?: string }).cursor;
      while (cursor) {
        const page = await repository.findAll({ limit: 2, cursor });
        seen.push(...page.items.map((item) => item.id));
        cursor = (page.meta as { cursor?: string }).cursor;
      }

      expect(seen).toEqual([...created].reverse());
    });

    it('keeps offset mode (with totals) when pagination is not requested', async () => {
      for (let i = 0; i < 3; i++) await repository.create(payload());

      const result = await repository.findAll({ limit: 2 });

      expect(result.meta).toMatchObject({ mode: 'offset', total: 3, totalPages: 2 });
    });

    it('rejects a forged cursor with 400', async () => {
      await expect(
        repository.findAll({ cursor: Buffer.from('not-an-id').toString('base64url') }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('searches invoice number and client fields case-insensitively', async () => {
      await repository.create(payload({ invoiceNumber: 'ACME-2026-01' }));
      await repository.create(
        payload({
          invoiceNumber: 'OTHER-1',
          client: { name: 'Globex', email: 'ap@globex.test', address: '2 Side St' },
        }),
      );

      const result = await repository.findAll({ search: 'acme-2026' });

      expect(result.items.map((i) => i.invoiceNumber)).toEqual(['ACME-2026-01']);
    });

    // Search text is user input: regex metacharacters must be literal, and an unbalanced pattern
    // must not reach Mongo as an invalid (or catastrophically backtracking) regex.
    it('treats regex metacharacters in the search term literally', async () => {
      await repository.create(payload({ invoiceNumber: 'INV.1' }));
      await repository.create(payload({ invoiceNumber: 'INVX1' }));

      expect((await repository.findAll({ search: 'INV.1' })).items.map((i) => i.invoiceNumber)).toEqual(['INV.1']);
      await expect(repository.findAll({ search: 'INV(' })).resolves.toMatchObject({ items: [] });
    });
  });
});
