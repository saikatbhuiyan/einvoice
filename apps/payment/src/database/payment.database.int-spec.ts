import { readdirSync } from 'fs';
import { join } from 'path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource, type MigrationInterface } from 'typeorm';
import { PaymentEntity } from './entities/payment.entity';
import { PaymentRepository } from '../app/modules/payment/payment.repository';

// Every migration file on disk, in the order `payment:migration:run` applies them.
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.ts'))
  .sort()
  .flatMap((file) => Object.values(require(join(MIGRATIONS_DIR, file)) as Record<string, unknown>))
  .filter((exported): exported is new () => MigrationInterface => typeof exported === 'function');

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
      entities: [PaymentEntity],
      migrations: applied,
    });
    await dataSource.initialize();
    return dataSource;
  }

  const insertPayment = (dataSource: DataSource, status: string, session: string, invoiceId = 'inv-1') =>
    dataSource.query(
      `INSERT INTO payments ("invoiceId", "providerSessionId", status, amount, currency) VALUES ($1, $2, $3, $4, $5)`,
      [invoiceId, session, status, 129.9, 'EUR'],
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
      await insertPayment(dataSource, 'paid', 'cs_paid');
      await insertPayment(dataSource, 'failed', 'cs_failed');

      for (const Migration of Later) await new Migration().up(runner);

      const rows = await dataSource.query(
        `SELECT "providerSessionId", status, amount FROM payments ORDER BY "providerSessionId"`,
      );
      expect(rows).toEqual([
        { providerSessionId: 'cs_failed', status: 'failed', amount: '129.90' },
        { providerSessionId: 'cs_paid', status: 'paid', amount: '129.90' },
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
    const before = migrations.slice(0, -1);
    const AddOpenSessionGuard = migrations[migrations.length - 1];
    const dataSource = await freshDataSource('open_session_dupes', []);
    const runner = dataSource.createQueryRunner();
    try {
      for (const Migration of before) await new Migration().up(runner);
      await insertPayment(dataSource, 'pending', 'cs_a', 'inv-dup');
      await insertPayment(dataSource, 'pending', 'cs_b', 'inv-dup');

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
});
