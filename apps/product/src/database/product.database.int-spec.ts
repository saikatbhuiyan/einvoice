import { readdirSync } from 'fs';
import { join } from 'path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { DEFAULT_ORGANIZATION_ID } from '@libs/shared/types';
import { runWithCorrelationContext } from '@libs/logging/correlation-context';
import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
import { ProductRepository } from '../app/modules/product/product.repository';
import { ProductEntity } from './entities/product.entity';

// Every migration file on disk, exactly what `product:migration:run` applies.
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const OTHER_ORG = '11111111-1111-4111-8111-111111111111';
const inOrganization = <T>(organizationId: string, work: () => Promise<T>) =>
  runWithCorrelationContext({ correlationId: 'int', traceId: 'int', organizationId }, work);

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.ts'))
  .sort()
  .flatMap((file) => Object.values(require(join(MIGRATIONS_DIR, file)) as Record<string, unknown>))
  .filter((exported): exported is new () => object => typeof exported === 'function');

/**
 * Reverts every migration from `name` (inclusive) onwards, newest first: tests about one migration
 * stay correct as later ones are added (undoing "the last migration" stops meaning that one).
 */
async function revertThrough(dataSource: DataSource, name: string): Promise<void> {
  const index = migrations.findIndex((migration) => migration.name === name);
  if (index < 0) throw new Error(`No migration named ${name}.`);
  for (let i = migrations.length - 1; i >= index; i--) await dataSource.undoLastMigration();
}

/** Integration test: product's migrations and repository against a real Postgres. */
describe('product database (real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let products: ProductRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [ProductEntity],
      migrations,
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    products = new ProductRepository(dataSource.getRepository(ProductEntity));
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await container?.stop();
  });

  beforeEach(() => dataSource.getRepository(ProductEntity).clear());

  const createProduct = (overrides: Partial<{ sku: string; name: string; unitPrice: number }> = {}) =>
    products.create({
      sku: `SKU-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Widget',
      unitPrice: 19.99,
      currency: 'USD',
      vatRate: 7.5,
      ...overrides,
    });

  describe('migrations', () => {
    it('produce exactly the schema the entity describes (no drift)', async () => {
      const pending = await dataSource.driver.createSchemaBuilder().log();

      expect(pending.upQueries.map((query) => query.query)).toEqual([]);
    });

    // Pre-tenancy products join the default organization, and nothing is lost on the way.
    it('move existing products into the default organization', async () => {
      await revertThrough(dataSource, 'AddOrganizationToProducts1792431483786');
      await dataSource.query(
        `INSERT INTO "products" ("sku", "name", "unitPrice", "currency") VALUES ('LEGACY-1', 'Old widget', 12.5, 'EUR')`,
      );

      await dataSource.runMigrations();

      expect(await dataSource.query(`SELECT "sku", "organizationId", "unitPrice" FROM "products"`)).toEqual([
        { sku: 'LEGACY-1', organizationId: DEFAULT_ORGANIZATION_ID, unitPrice: '12.50' },
      ]);
    });

    it('refuse to revert tenancy while two organizations share a SKU', async () => {
      await createProduct({ sku: 'SHARED' });
      await inOrganization(OTHER_ORG, () => createProduct({ sku: 'SHARED' }));

      await expect(revertThrough(dataSource, 'AddOrganizationToProducts1792431483786')).rejects.toThrow(/SHARED/);
      // Leave the schema complete for the next test (the failed revert rolled back only itself).
      await dataSource.runMigrations();
    });

    // Bangladesh supplementary duty: existing products get 0, so their invoices' arithmetic is unchanged.
    it('give existing products an SD rate of 0, keeping their prices', async () => {
      await revertThrough(dataSource, 'AddSdRateToProducts1792577019000');
      // Raw SQL: the entity already has the column this schema lacks.
      await dataSource.query(
        `INSERT INTO "products" ("organizationId", "sku", "name", "unitPrice", "currency") VALUES ($1, 'BEFORE-SD', 'Old', 1500.55, 'BDT')`,
        [ORG],
      );

      await dataSource.runMigrations();

      expect(await dataSource.query(`SELECT "sku", "unitPrice", "sdRate" FROM "products"`)).toEqual([
        { sku: 'BEFORE-SD', unitPrice: '1500.55', sdRate: '0.00' },
      ]);
    });

    it('revert cleanly and re-apply', async () => {
      for (let i = 0; i < migrations.length; i++) await dataSource.undoLastMigration();
      expect(await dataSource.query(`SELECT to_regclass('public.products') AS t`)).toEqual([{ t: null }]);

      await dataSource.runMigrations();
      expect(await dataSource.query(`SELECT to_regclass('public.products') AS t`)).toEqual([{ t: 'products' }]);
    });
  });

  it('enforces unique SKUs per organization at the database', async () => {
    await createProduct({ sku: 'DUP-1' });

    await expect(createProduct({ sku: 'DUP-1' })).rejects.toMatchObject({
      driverError: expect.objectContaining({ code: '23505' }),
    });
    // Another organization's catalog is its own.
    await expect(inOrganization(OTHER_ORG, () => createProduct({ sku: 'DUP-1' }))).resolves.toBeDefined();
  });

  it("lists only the current organization's products, and can't be told to create in another", async () => {
    const mine = await createProduct({ name: 'Mine' });
    await inOrganization(OTHER_ORG, () => createProduct({ name: 'Theirs' }));
    const planted = await products.create({
      sku: 'PLANTED',
      name: 'Planted',
      unitPrice: 1,
      currency: 'USD',
      vatRate: 0,
      organizationId: OTHER_ORG,
    } as never);

    expect(planted.organizationId).toBe(ORG);
    expect((await products.findAll({})).items.map((p) => p.id).sort()).toEqual([mine.id, planted.id].sort());
    expect(await inOrganization(OTHER_ORG, async () => (await products.findAll({})).items.map((p) => p.name))).toEqual([
      'Theirs',
    ]);
  });

  describe('findOne / findMany / update (catalog-backed invoice lines)', () => {
    it("finds only the current organization's products", async () => {
      const mine = await createProduct();
      const theirs = await inOrganization(OTHER_ORG, () => createProduct());

      expect((await products.findOne(mine.id))?.id).toBe(mine.id);
      await expect(products.findOne(theirs.id)).resolves.toBeNull();
      expect((await products.findMany([mine.id, theirs.id])).map((p) => p.id)).toEqual([mine.id]);
      await expect(products.findMany([])).resolves.toEqual([]);
    });

    it('updates only the given fields, and returns the stored row', async () => {
      const created = await createProduct({ name: 'Widget', unitPrice: 19.99 });

      const updated = await products.update(created.id, { unitPrice: 1500.55, sdRate: 20, name: undefined });

      expect(updated).toMatchObject({ id: created.id, name: 'Widget', unitPrice: 1500.55, sdRate: 20, vatRate: 7.5 });
    });

    // An id, an organizationId or a timestamp in the payload is not a product field: RPC payloads skip DTO validation.
    it("can't move a product to another organization or change its id", async () => {
      const created = await createProduct();

      await products.update(created.id, { organizationId: OTHER_ORG, id: 'x', name: 'Renamed' } as never);

      expect(await products.findOne(created.id)).toMatchObject({ organizationId: ORG, name: 'Renamed' });
    });

    it("is null for another organization's product, which stays unchanged", async () => {
      const theirs = await inOrganization(OTHER_ORG, () => createProduct({ name: 'Theirs' }));

      await expect(products.update(theirs.id, { name: 'Hijacked' })).resolves.toBeNull();
      await expect(products.update(theirs.id, {})).resolves.toBeNull();
      expect(await inOrganization(OTHER_ORG, () => products.findOne(theirs.id))).toMatchObject({ name: 'Theirs' });
    });

    it('rejects a SKU another product of the organization has', async () => {
      await createProduct({ sku: 'TAKEN' });
      const other = await createProduct({ sku: 'FREE' });

      await expect(products.update(other.id, { sku: 'TAKEN' })).rejects.toMatchObject({
        driverError: expect.objectContaining({ code: '23505' }),
      });
    });
  });

  // numeric columns come back from pg as strings; the entity's transformer must turn them back
  // into exact numbers — not 19.990000000001, not "19.99".
  it('round-trips numeric prices and VAT rates as exact numbers', async () => {
    const created = await createProduct({ unitPrice: 19.99 });

    const [listed] = (await products.findAll({})).items.filter((p) => p.id === created.id);
    expect(listed.unitPrice).toBe(19.99);
    expect(listed.vatRate).toBe(7.5);
  });

  it('treats % and _ in the search term literally', async () => {
    await createProduct({ name: 'Plain Widget' });
    await createProduct({ name: 'Under_Score' });

    expect((await products.findAll({ search: '_' })).items.map((p) => p.name)).toEqual(['Under_Score']);
    expect((await products.findAll({ search: 'widget' })).items.map((p) => p.name)).toEqual(['Plain Widget']);
  });
});
