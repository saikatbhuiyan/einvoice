import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import mongoose, { Types, type Connection } from 'mongoose';
import { DEFAULT_ORGANIZATION_ID } from '@libs/shared/types';
import { backfillTenancy } from './tenancy-backfill';
import { diffOwnedIndexes, syncOwnedIndexes } from './index-sync';

/**
 * Integration test: the deploy path from a pre-tenancy database -- `backfill-tenancy`, then
 * `sync-indexes` -- against real MongoDB, starting from documents and indexes exactly as the
 * previous version wrote them. Ends with the drift check: every owned collection's indexes are the
 * schemas', the Mongo equivalent of the TypeORM apps' empty `createSchemaBuilder().log()`.
 */
describe('tenancy migration (backfill + index sync) against real MongoDB', () => {
  let container: StartedMongoDBContainer;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:7').start();
  });

  afterAll(async () => {
    await container?.stop();
  });

  let connection: Connection;
  afterEach(async () => {
    await connection?.close();
  });

  const connect = async (dbName: string) => {
    connection = await mongoose
      .createConnection(container.getConnectionString(), { directConnection: true, dbName })
      .asPromise();
    return { db: connection.db as mongoose.mongo.Db };
  };

  const legacyInvoice = (fields: Record<string, unknown>) => ({
    _id: new Types.ObjectId(),
    client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Main St' },
    items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPrice: 100, vatRate: 0, total: 100 }],
    currency: 'USD',
    issueDate: new Date('2026-03-01T00:00:00.000Z'),
    deletedAt: null,
    version: 0,
    ...fields,
  });

  /** A database as the pre-tenancy version left it: no organizations, global unique indexes. */
  async function seedPreTenancy(db: mongoose.mongo.Db) {
    const invoices = db.collection('invoices');
    await invoices.createIndex({ invoiceNumber: 1 }, { unique: true });
    await invoices.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true });
    const docs = {
      issued2026: legacyInvoice({ status: 'paid', invoiceNumber: 'INV-2026-000041' }),
      issued2026b: legacyInvoice({ status: 'issued', invoiceNumber: 'INV-2026-000007' }),
      issued2025: legacyInvoice({ status: 'cancelled', invoiceNumber: 'INV-2025-000120' }),
      // Not the numbering service's format: can't collide with a number it will issue.
      freeForm: legacyInvoice({ status: 'issued', invoiceNumber: 'ACME-77' }),
      draftNoReference: legacyInvoice({ status: 'draft', invoiceNumber: 'DRAFT-1' }),
      draftWithReference: legacyInvoice({ status: 'draft', invoiceNumber: 'INV-2026-000999', reference: 'PO-9' }),
    };
    await invoices.insertMany(Object.values(docs));
    await db.collection('audit_logs').insertMany([
      { action: 'CREATE', entityType: 'invoice', entityId: String(docs.issued2026._id) },
      { action: 'CREATE', entityType: 'invoice', entityId: String(docs.freeForm._id) },
    ]);
    return docs;
  }

  it('moves pre-tenancy data into the default organization, renumbers nothing, and leaves no index drift', async () => {
    const { db } = await connect('pre_tenancy');
    const docs = await seedPreTenancy(db as never);

    const report = await backfillTenancy(db as never, { dryRun: false, prefix: 'INV' });
    await syncOwnedIndexes(connection);

    expect(report).toEqual({
      legacyIndexesDropped: ['invoiceNumber_1', 'idempotencyKey_1'],
      invoicesAssigned: 6,
      draftNumbersMovedToReference: 1,
      draftNumbersDropped: [String(docs.draftWithReference._id)],
      auditEntriesAssigned: 2,
      counters: { [`${DEFAULT_ORGANIZATION_ID}:2026`]: 41, [`${DEFAULT_ORGANIZATION_ID}:2025`]: 120 },
    });

    const invoices = db.collection('invoices');
    expect(await invoices.countDocuments({ organizationId: DEFAULT_ORGANIZATION_ID })).toBe(6);
    // Issued numbers are legal records: untouched.
    expect(await invoices.findOne({ _id: docs.issued2026._id })).toMatchObject({ invoiceNumber: 'INV-2026-000041' });
    expect(await invoices.findOne({ _id: docs.freeForm._id })).toMatchObject({ invoiceNumber: 'ACME-77' });
    // Drafts are numbered on issue now; a client-chosen draft number survives as its reference.
    const draftNoReference = await invoices.findOne({ _id: docs.draftNoReference._id });
    expect(draftNoReference).toMatchObject({ reference: 'DRAFT-1' });
    expect(draftNoReference).not.toHaveProperty('invoiceNumber');
    expect(await invoices.findOne({ _id: docs.draftWithReference._id })).toMatchObject({ reference: 'PO-9' });

    expect(await db.collection('audit_logs').countDocuments({ organizationId: DEFAULT_ORGANIZATION_ID })).toBe(2);
    // The next default-organization number in 2026 is 42, so it can't collide with 41.
    expect(await db.collection('invoice_counters').find().sort({ _id: 1 }).toArray()).toEqual([
      { _id: `${DEFAULT_ORGANIZATION_ID}:2025`, seq: 120 },
      { _id: `${DEFAULT_ORGANIZATION_ID}:2026`, seq: 41 },
    ]);

    // The legacy global uniques are gone (they would reject the same number in two organizations)...
    const indexNames = (await invoices.indexes()).map((index) => index.name);
    expect(indexNames).not.toContain('invoiceNumber_1');
    expect(indexNames).not.toContain('idempotencyKey_1');
    await expect(
      invoices.insertOne(
        legacyInvoice({ organizationId: 'org-b', status: 'issued', invoiceNumber: 'INV-2026-000041' }),
      ),
    ).resolves.toBeDefined();
    // ...and per-organization uniqueness is enforced by the new ones.
    await expect(
      invoices.insertOne(
        legacyInvoice({ organizationId: DEFAULT_ORGANIZATION_ID, status: 'issued', invoiceNumber: 'INV-2026-000041' }),
      ),
    ).rejects.toMatchObject({ code: 11000 });

    // Drift check.
    expect((await diffOwnedIndexes(connection)).filter((d) => d.toCreate.length || d.toDrop.length)).toEqual([]);
  });

  it('is idempotent: a second run changes nothing, and never moves a counter backwards', async () => {
    const { db } = await connect('rerun');
    await seedPreTenancy(db as never);
    await backfillTenancy(db as never, { dryRun: false, prefix: 'INV' });
    // Numbers issued after the migration ran.
    await db
      .collection('invoice_counters')
      .updateOne({ _id: `${DEFAULT_ORGANIZATION_ID}:2026` as never }, { $set: { seq: 50 } });
    const auditBefore = await db.collection('audit_logs').find().toArray();

    const second = await backfillTenancy(db as never, { dryRun: false, prefix: 'INV' });

    expect(second).toMatchObject({
      legacyIndexesDropped: [],
      invoicesAssigned: 0,
      draftNumbersMovedToReference: 0,
      auditEntriesAssigned: 0,
    });
    expect(
      await db.collection('invoice_counters').findOne({ _id: `${DEFAULT_ORGANIZATION_ID}:2026` as never }),
    ).toMatchObject({
      seq: 50,
    });
    expect(await db.collection('audit_logs').find().toArray()).toEqual(auditBefore);
  });

  it('reports without writing on a dry run', async () => {
    const { db } = await connect('dry_run');
    await seedPreTenancy(db as never);

    const report = await backfillTenancy(db as never, { dryRun: true, prefix: 'INV' });

    expect(report).toMatchObject({ invoicesAssigned: 6, draftNumbersMovedToReference: 1 });
    expect(await db.collection('invoices').countDocuments({ organizationId: { $exists: true } })).toBe(0);
    expect(await db.collection('invoice_counters').countDocuments()).toBe(0);
    expect((await db.collection('invoices').indexes()).map((index) => index.name)).toContain('invoiceNumber_1');
  });

  it('runs on a database that has never had an invoice', async () => {
    const { db } = await connect('empty');

    await expect(backfillTenancy(db as never, { dryRun: false, prefix: 'INV' })).resolves.toMatchObject({
      legacyIndexesDropped: [],
      invoicesAssigned: 0,
      counters: {},
    });
  });

  it('builds every owned index on a fresh database', async () => {
    await connect('fresh');

    expect((await diffOwnedIndexes(connection)).some((d) => d.toCreate.length > 0)).toBe(true);
    await syncOwnedIndexes(connection);
    expect((await diffOwnedIndexes(connection)).filter((d) => d.toCreate.length || d.toDrop.length)).toEqual([]);
  });
});
