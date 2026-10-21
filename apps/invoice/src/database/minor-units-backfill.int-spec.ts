import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import mongoose, { Types, type Connection } from 'mongoose';
import { InvoiceModelName, InvoiceSchema } from '@libs/schemas';
import { presentInvoice } from '../app/modules/invoice/invoice-presenter';
import { backfillMinorUnits } from './minor-units-backfill';

const ORG = '00000000-0000-4000-8000-000000000001';

/**
 * Integration test: `backfill-minor-units` against real MongoDB, starting from documents exactly as
 * the float-based version wrote them (amounts computed by its rounding), and ending with the new
 * version reading them: the API must return the same decimals it returned before.
 */
describe('minor-units backfill against real MongoDB', () => {
  let container: StartedMongoDBContainer;
  let connection: Connection;
  let db: mongoose.mongo.Db;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:7').start();
    connection = await mongoose
      .createConnection(container.getConnectionString(), { directConnection: true, dbName: 'minor_units' })
      .asPromise();
    db = connection.db as mongoose.mongo.Db;
  });

  afterAll(async () => {
    await connection?.close();
    await container?.stop();
  });

  beforeEach(() => db.collection('invoices').deleteMany({}));

  const invoices = () => db.collection('invoices');

  /** A document as the previous version stored it. */
  interface LegacyFields {
    items: { catalogId: string; name: string; quantity: number; unitPrice: number; vatRate: number; total: number }[];
    subtotal: number;
    vatTotal: number;
    total: number;
    [field: string]: unknown;
  }
  const legacy = (fields: LegacyFields) => ({
    _id: new Types.ObjectId(),
    organizationId: ORG,
    status: 'issued',
    client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Main St' },
    currency: 'USD',
    issueDate: new Date('2026-03-01T00:00:00.000Z'),
    deletedAt: null,
    version: 3,
    ...fields,
  });

  // Each one's amounts are what the old pre-validate hook (roundCurrency per step) stored.
  const fixtures = () => ({
    usd: legacy({
      invoiceNumber: 'INV-2026-000001',
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 2, unitPrice: 50, vatRate: 10, total: 110 }],
      subtotal: 100,
      vatTotal: 10,
      total: 110,
    }),
    // 0.30000000000000004 and 0.045 in floats: the old hook still landed on 0.30 / 0.05.
    floatNoise: legacy({
      invoiceNumber: 'INV-2026-000002',
      items: [{ catalogId: 'sku-2', name: 'Bolt', quantity: 3, unitPrice: 0.1, vatRate: 15, total: 0.35 }],
      subtotal: 0.3,
      vatTotal: 0.05,
      total: 0.35,
    }),
    // 1.5 x 1500.55 is exactly 2250.825, but 2250.8249999... as a float: the old hook stored
    // 2250.82 where half-up gives 2250.83. Exactly the drift this migration exists to end.
    bdtDraft: legacy({
      status: 'draft',
      currency: 'BDT',
      items: [
        { catalogId: 'svc', name: 'Consulting', quantity: 1.5, unitPrice: 1500.55, vatRate: 7.5, total: 2419.63 },
      ],
      subtotal: 2250.82,
      vatTotal: 168.81,
      total: 2419.63,
    }),
    deleted: legacy({
      status: 'draft',
      deletedAt: new Date('2026-03-02T00:00:00.000Z'),
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPrice: 10, vatRate: 0, total: 10 }],
      subtotal: 10,
      vatTotal: 0,
      total: 10,
    }),
  });

  it('converts every legacy invoice, deleted ones included, and the API reads back the same decimals', async () => {
    const docs = fixtures();
    await invoices().insertMany(Object.values(docs));

    const report = await backfillMinorUnits(db as never, { dryRun: false, acceptRecomputed: false });

    expect(report).toEqual({
      invoicesConverted: 4,
      // A draft isn't a record yet: converted with the exact amounts, and listed.
      draftsRecomputed: [
        {
          id: String(docs.bdtDraft._id),
          status: 'draft',
          currency: 'BDT',
          stored: { netMinor: 225_082, vatMinor: 16_881, totalMinor: 241_963 },
          recomputed: { netMinor: 225_083, vatMinor: 16_881, totalMinor: 241_964 },
        },
      ],
      mismatches: [],
      unconvertible: [],
    });

    const usd = await invoices().findOne({ _id: docs.usd._id });
    expect(usd).toMatchObject({
      netMinor: 10_000,
      sdMinor: 0,
      vatMinor: 1000,
      totalMinor: 11_000,
      // Untouched: a migration is not an edit.
      version: 3,
      invoiceNumber: 'INV-2026-000001',
    });
    expect(usd?.['items']).toEqual([
      {
        catalogId: 'sku-1',
        name: 'Widget',
        quantity: 2,
        unitPriceMinor: 5000,
        vatRate: 10,
        sdRate: 0,
        netMinor: 10_000,
        sdMinor: 0,
        vatMinor: 1000,
        totalMinor: 11_000,
      },
    ]);
    for (const field of ['subtotal', 'vatTotal', 'total']) expect(usd).not.toHaveProperty(field);

    // The new version's read path: the Mongoose model, then the presenter.
    const Invoice = connection.model(InvoiceModelName, InvoiceSchema);
    for (const doc of [docs.usd, docs.floatNoise]) {
      const loaded = await Invoice.findById(doc._id).orFail();
      const response = presentInvoice(loaded.toJSON());
      expect(response).toMatchObject({ subtotal: doc.subtotal, vatTotal: doc.vatTotal, total: doc.total, sdTotal: 0 });
      expect(response.items[0]).toMatchObject({ unitPrice: doc.items[0].unitPrice, total: doc.items[0].total });
      // And it is a valid document under the new schema (an edit would save it).
      await expect(loaded.validate()).resolves.toBeUndefined();
    }
    const bdt = presentInvoice((await Invoice.findById(docs.bdtDraft._id).orFail()).toJSON());
    expect(bdt).toMatchObject({ subtotal: 2250.83, vatTotal: 168.81, total: 2419.64 });
  });

  it('is idempotent, and a dry run writes nothing', async () => {
    await invoices().insertMany(Object.values(fixtures()));
    const before = await invoices().find().toArray();

    const dry = await backfillMinorUnits(db as never, { dryRun: true, acceptRecomputed: false });
    expect(dry.invoicesConverted).toBe(4);
    expect(await invoices().find().toArray()).toEqual(before);

    await backfillMinorUnits(db as never, { dryRun: false, acceptRecomputed: false });
    const after = await invoices().find().toArray();
    const again = await backfillMinorUnits(db as never, { dryRun: false, acceptRecomputed: false });

    expect(again.invoicesConverted).toBe(0);
    expect(await invoices().find().toArray()).toEqual(after);
  });

  // An issued invoice is a legal record: if the engine disagrees with what was issued, a human decides.
  it('leaves an issued invoice whose amounts would change unconverted and reports it, unless accepted', async () => {
    const tampered = legacy({
      invoiceNumber: 'INV-2026-000009',
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPrice: 100, vatRate: 15, total: 115.01 }],
      subtotal: 100,
      vatTotal: 15.01,
      total: 115.01,
    });
    const draft = legacy({
      status: 'draft',
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPrice: 100, vatRate: 15, total: 115.01 }],
      subtotal: 100,
      vatTotal: 15.01,
      total: 115.01,
    });
    await invoices().insertMany([tampered, draft]);

    const report = await backfillMinorUnits(db as never, { dryRun: false, acceptRecomputed: false });

    const mismatch = (id: Types.ObjectId, status: string) => ({
      id: String(id),
      status,
      currency: 'USD',
      stored: { netMinor: 10_000, vatMinor: 1501, totalMinor: 11_501 },
      recomputed: { netMinor: 10_000, vatMinor: 1500, totalMinor: 11_500 },
    });
    expect(report).toEqual({
      invoicesConverted: 1,
      draftsRecomputed: [mismatch(draft._id, 'draft')],
      mismatches: [mismatch(tampered._id, 'issued')],
      unconvertible: [],
    });
    expect(await invoices().findOne({ _id: tampered._id })).toMatchObject({ total: 115.01 });
    expect(await invoices().findOne({ _id: tampered._id })).not.toHaveProperty('totalMinor');
    expect(await invoices().findOne({ _id: draft._id })).toMatchObject({ totalMinor: 11_500 });

    const accepted = await backfillMinorUnits(db as never, { dryRun: false, acceptRecomputed: true });

    expect(accepted.invoicesConverted).toBe(1);
    expect(await invoices().findOne({ _id: tampered._id })).toMatchObject({ totalMinor: 11_500 });
  });

  it('reports documents that cannot be expressed exactly, converting nothing of them', async () => {
    const yen = legacy({
      currency: 'JPY',
      items: [{ catalogId: 'x', name: 'X', quantity: 1, unitPrice: 100, vatRate: 0, total: 100 }],
      subtotal: 100,
      vatTotal: 0,
      total: 100,
    });
    const finePrice = legacy({
      items: [{ catalogId: 'x', name: 'X', quantity: 1, unitPrice: 1.005, vatRate: 0, total: 1.01 }],
      subtotal: 1.01,
      vatTotal: 0,
      total: 1.01,
    });
    await invoices().insertMany([yen, finePrice]);

    const report = await backfillMinorUnits(db as never, { dryRun: false, acceptRecomputed: true });

    expect(report.invoicesConverted).toBe(0);
    expect(report.unconvertible).toEqual([
      { id: String(yen._id), reason: 'unsupported currency "JPY"' },
      { id: String(finePrice._id), reason: '1.005 USD has more than 2 decimal places.' },
    ]);
    expect(await invoices().countDocuments({ totalMinor: { $exists: true } })).toBe(0);
  });
});
