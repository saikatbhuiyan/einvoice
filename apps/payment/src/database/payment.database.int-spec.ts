import { readdirSync } from 'fs';
import { join } from 'path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource, type MigrationInterface } from 'typeorm';
import { PaymentEntity } from './entities/payment.entity';
import { ProviderCredentialEntity } from './entities/provider-credential.entity';
import { randomBytes } from 'crypto';
import { PaymentRepository } from '../app/modules/payment/payment.repository';
import { ProviderCredentialsService } from '../app/modules/payment/credentials/provider-credentials.service';
import { DEFAULT_ORGANIZATION_ID } from '@libs/shared/types';
import { runInOrganization } from '@libs/logging/correlation-context';
import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';

// Every migration file on disk, in the order `payment:migration:run` applies them.
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.ts'))
  .sort()
  .flatMap((file) => Object.values(require(join(MIGRATIONS_DIR, file)) as Record<string, unknown>))
  .filter((exported): exported is new () => MigrationInterface => typeof exported === 'function');

const migrationNamed = (prefix: string) => {
  const index = migrations.findIndex((Migration) => Migration.name.startsWith(prefix));
  if (index === -1) throw new Error(`${prefix} migration not found`);
  return index;
};

/**
 * Integration test: payment's migrations against a real Postgres. Includes a regression for the
 * incident recorded in CLAUDE.md: the generated migration widening `status` was DROP COLUMN + ADD
 * COLUMN, which would have reset every payment — paid ones included — to 'pending'.
 */
describe('payment database (real Postgres)', () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
  });

  afterAll(async () => {
    await container?.stop();
  });

  // A fresh database per test, so migrations can be applied one at a time.
  async function freshDataSource(name: string, applied: Array<new () => MigrationInterface> = migrations) {
    const admin = new DataSource({ type: 'postgres', url: container.getConnectionUri() });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.destroy();

    const url = new URL(container.getConnectionUri());
    url.pathname = `/${name}`;
    const dataSource = new DataSource({
      type: 'postgres',
      url: url.toString(),
      entities: [PaymentEntity, ProviderCredentialEntity],
      migrations: applied,
    });
    await dataSource.initialize();
    return dataSource;
  }

  // organizationId: null for a pre-tenancy schema (no such column yet).
  const insertPayment = (
    dataSource: DataSource,
    status: string,
    session: string,
    invoiceId = 'inv-1',
    organizationId: string | null = ORG,
  ) =>
    organizationId === null
      ? dataSource.query(
          `INSERT INTO payments ("invoiceId", "providerSessionId", status, amount, currency) VALUES ($1, $2, $3, $4, $5)`,
          [invoiceId, session, status, 129.9, 'EUR'],
        )
      : dataSource.query(
          `INSERT INTO payments ("organizationId", "invoiceId", "providerSessionId", status, amount, currency) VALUES ($1, $2, $3, $4, $5, $6)`,
          [organizationId, invoiceId, session, status, 129.9, 'EUR'],
        );

  it('produce exactly the schema the entity describes (no drift)', async () => {
    const dataSource = await freshDataSource('drift');
    try {
      await dataSource.runMigrations();
      const pending = await dataSource.driver.createSchemaBuilder().log();

      expect(pending.upQueries.map((query) => query.query)).toEqual([]);
    } finally {
      await dataSource.destroy();
    }
  });

  // Applies each migration's up() by hand so rows can be written *between* them — the state a
  // production database is actually in when a later migration runs.
  it('keeps existing payments’ status when widening the column (no DROP/ADD data loss)', async () => {
    const [CreateTable, ...Later] = migrations;
    const dataSource = await freshDataSource('widen', []);
    const runner = dataSource.createQueryRunner();
    try {
      await new CreateTable().up(runner);
      await insertPayment(dataSource, 'paid', 'cs_paid', 'inv-1', null);
      await insertPayment(dataSource, 'failed', 'cs_failed', 'inv-1', null);

      for (const Migration of Later) await new Migration().up(runner);

      const rows = await dataSource.query(
        `SELECT "providerSessionId", status, amount, "organizationId" FROM payments ORDER BY "providerSessionId"`,
      );
      // ...and, through the tenancy migration, into the default organization (where their invoices went).
      expect(rows).toEqual([
        { providerSessionId: 'cs_failed', status: 'failed', amount: '129.90', organizationId: DEFAULT_ORGANIZATION_ID },
        { providerSessionId: 'cs_paid', status: 'paid', amount: '129.90', organizationId: DEFAULT_ORGANIZATION_ID },
      ]);
      await expect(insertPayment(dataSource, 'reconciliation_required', 'cs_recon')).resolves.toBeDefined();
    } finally {
      await runner.release();
      await dataSource.destroy();
    }
  });

  // Narrowing back would truncate 'reconciliation_required'; Postgres must refuse rather than lose it.
  // Targets the widening migration by name, not as "the last one": later migrations exist.
  it('refuses to revert the widening while a status longer than the old column exists', async () => {
    const Widen = migrations.find((Migration) => Migration.name.startsWith('WidenPaymentStatusColumn'));
    if (!Widen) throw new Error('WidenPaymentStatusColumn migration not found');
    const dataSource = await freshDataSource('revert');
    const runner = dataSource.createQueryRunner();
    try {
      await dataSource.runMigrations();
      await insertPayment(dataSource, 'reconciliation_required', 'cs_recon');

      await expect(new Widen().down(runner)).rejects.toMatchObject({
        driverError: expect.objectContaining({ code: '22001' }),
      });
      expect(await dataSource.query(`SELECT status FROM payments`)).toEqual([{ status: 'reconciliation_required' }]);
    } finally {
      await runner.release();
      await dataSource.destroy();
    }
  });

  it('enforces one payment row per Stripe checkout session', async () => {
    const dataSource = await freshDataSource('unique');
    try {
      await dataSource.runMigrations();
      await insertPayment(dataSource, 'pending', 'cs_1');

      await expect(insertPayment(dataSource, 'pending', 'cs_1')).rejects.toMatchObject({
        driverError: expect.objectContaining({ code: '23505' }),
      });
    } finally {
      await dataSource.destroy();
    }
  });

  // Two concurrent "pay" clicks must not both leave a payable Stripe session behind.
  it('allows at most one pending (open) session per invoice, but any number of closed ones', async () => {
    const dataSource = await freshDataSource('open_session');
    try {
      await dataSource.runMigrations();
      await insertPayment(dataSource, 'pending', 'cs_open');

      await expect(insertPayment(dataSource, 'pending', 'cs_second_open')).rejects.toMatchObject({
        driverError: expect.objectContaining({ code: '23505' }),
      });
      await expect(insertPayment(dataSource, 'failed', 'cs_failed_1')).resolves.toBeDefined();
      await expect(insertPayment(dataSource, 'failed', 'cs_failed_2')).resolves.toBeDefined();
      await expect(insertPayment(dataSource, 'pending', 'cs_other_invoice', 'inv-2')).resolves.toBeDefined();
    } finally {
      await dataSource.destroy();
    }
  });

  // Each duplicate is a session a customer may still pay through; choosing one is a human call.
  it('refuses to add the open-session index over existing duplicates, naming the invoices, and changes nothing', async () => {
    const guardIndex = migrationNamed('AddOpenSessionGuardToPayments');
    const before = migrations.slice(0, guardIndex);
    const AddOpenSessionGuard = migrations[guardIndex];
    const dataSource = await freshDataSource('open_session_dupes', []);
    const runner = dataSource.createQueryRunner();
    try {
      for (const Migration of before) await new Migration().up(runner);
      await insertPayment(dataSource, 'pending', 'cs_a', 'inv-dup', null);
      await insertPayment(dataSource, 'pending', 'cs_b', 'inv-dup', null);

      await expect(new AddOpenSessionGuard().up(runner)).rejects.toThrow(/more than one pending payment: inv-dup\./);
      expect(await dataSource.query(`SELECT status FROM payments ORDER BY "providerSessionId"`)).toEqual([
        { status: 'pending' },
        { status: 'pending' },
      ]);
    } finally {
      await runner.release();
      await dataSource.destroy();
    }
  });

  it('PaymentRepository finds the open session and detects another collected payment', async () => {
    const dataSource = await freshDataSource('repository');
    try {
      await dataSource.runMigrations();
      const repository = new PaymentRepository(dataSource.getRepository(PaymentEntity));
      const expiresAt = new Date('2026-10-20T12:00:00.000Z');
      const first = await repository.create({
        invoiceId: 'inv-1',
        provider: 'stripe',
        providerSessionId: 'cs_first',
        status: 'pending',
        amount: 129.9,
        currency: 'EUR',
        checkoutUrl: 'https://checkout.stripe.test/cs_first',
        expiresAt,
      });

      expect(await repository.findOpenByInvoiceId('inv-1')).toMatchObject({ id: first.id, expiresAt });
      expect(await repository.findOpenByInvoiceId('inv-2')).toBeNull();
      expect(await repository.hasOtherPaidPayment('inv-1', first.id)).toBe(false);

      await repository.updateStatus(first.id, 'paid');
      await insertPayment(dataSource, 'pending', 'cs_second');
      const second = await repository.findOpenByInvoiceId('inv-1');
      if (!second) throw new Error('second open payment not found');

      expect(await repository.hasOtherPaidPayment('inv-1', second.id)).toBe(true);
      // A payment is never "another" payment relative to itself.
      expect(await repository.hasOtherPaidPayment('inv-1', first.id)).toBe(false);
    } finally {
      await dataSource.destroy();
    }
  });

  it("stamps the caller's organization, and sees nothing of another organization's payments", async () => {
    const dataSource = await freshDataSource('tenancy');
    try {
      await dataSource.runMigrations();
      const repository = new PaymentRepository(dataSource.getRepository(PaymentEntity));
      const theirs = await runInOrganization('11111111-1111-4111-8111-111111111111', () =>
        repository.create({
          invoiceId: 'inv-theirs',
          provider: 'stripe',
          providerSessionId: 'cs_theirs',
          status: 'pending',
          amount: 10,
          currency: 'EUR',
          checkoutUrl: 'https://checkout.stripe.test/cs_theirs',
          expiresAt: new Date('2026-10-20T12:00:00.000Z'),
        }),
      );

      expect(await repository.findOpenByInvoiceId('inv-theirs')).toBeNull();
      expect(await repository.updateStatus(theirs.id, 'failed')).toBeNull();
      expect(await dataSource.query(`SELECT status FROM payments`)).toEqual([{ status: 'pending' }]);
      // The webhook's lookup is the one that isn't scoped: it learns the organization from the row.
      expect(await repository.findByProviderSessionId('cs_theirs')).toMatchObject({
        organizationId: '11111111-1111-4111-8111-111111111111',
      });
    } finally {
      await dataSource.destroy();
    }
  });

  // The store password must never be readable from the database; a reconnect replaces the one row;
  // a disconnect keeps it (disabled) so payments already started can still be confirmed.
  it('stores SSLCommerz store passwords only encrypted, one row per organization, kept when disconnected', async () => {
    const dataSource = await freshDataSource('credentials');
    try {
      await dataSource.runMigrations();
      const key = randomBytes(32).toString('base64');
      const accepts = { checkCredentials: async () => true };
      const service = new ProviderCredentialsService(
        dataSource.getRepository(ProviderCredentialEntity),
        accepts as never,
        { credentialsKey: key },
      );

      await service.setSslCommerz({ storeId: 'testbox', storePassword: 'qwerty-secret', sandbox: true });
      await service.setSslCommerz({ storeId: 'acmeltd', storePassword: 'live-secret', sandbox: false });

      const rows = await dataSource.query(`SELECT * FROM provider_credentials`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        organizationId: ORG,
        provider: 'sslcommerz',
        accountId: 'acmeltd',
        sandbox: false,
      });
      expect(JSON.stringify(rows)).not.toMatch(/qwerty-secret|live-secret/);
      await expect(service.resolveSslCommerz()).resolves.toEqual({
        storeId: 'acmeltd',
        storePassword: 'live-secret',
        sandbox: false,
      });

      await service.deleteSslCommerz();
      expect(await service.hasSslCommerz()).toBe(false);
      await expect(service.resolveSslCommerz()).rejects.toThrow('No SSLCommerz store is connected');
      await expect(service.resolveSslCommerz({ forSettlement: true })).resolves.toMatchObject({ storeId: 'acmeltd' });

      // Another organization sees none of it.
      await runInOrganization('11111111-1111-4111-8111-111111111111', async () => {
        expect(await service.hasSslCommerz()).toBe(false);
        await expect(service.resolveSslCommerz({ forSettlement: true })).rejects.toThrow('No SSLCommerz store');
      });

      // Reconnecting re-enables the same row.
      await service.setSslCommerz({ storeId: 'acmeltd', storePassword: 'rotated', sandbox: false });
      expect(await service.hasSslCommerz()).toBe(true);
      expect(await dataSource.query(`SELECT count(*)::int AS n FROM provider_credentials`)).toEqual([{ n: 1 }]);
    } finally {
      await dataSource.destroy();
    }
  });

  // An SSLCommerz payment is recorded before its session exists (no link yet), then gets its link.
  it('records an SSLCommerz payment without a link, then stores the link', async () => {
    const dataSource = await freshDataSource('recorded');
    try {
      await dataSource.runMigrations();
      const repository = new PaymentRepository(dataSource.getRepository(PaymentEntity));
      const payment = await repository.create({
        invoiceId: 'inv-bdt',
        provider: 'sslcommerz',
        providerSessionId: 'einv0123456789abcdef0123456789',
        status: 'pending',
        amount: 1380.5,
        currency: 'BDT',
      });
      expect(payment).toMatchObject({ checkoutUrl: null, expiresAt: null });

      await repository.setCheckout(
        payment.id,
        'https://sandbox.sslcommerz.com/EasyCheckOut/x',
        new Date('2026-10-22T12:00:00Z'),
      );
      await repository.updateStatus(payment.id, 'superseded');

      expect(await repository.findByProviderSessionId('einv0123456789abcdef0123456789')).toMatchObject({
        checkoutUrl: 'https://sandbox.sslcommerz.com/EasyCheckOut/x',
        status: 'superseded',
        amount: 1380.5,
      });
      // superseded is not open: a new session for the invoice may be recorded.
      expect(await repository.findOpenByInvoiceId('inv-bdt')).toBeNull();
    } finally {
      await dataSource.destroy();
    }
  });
});
