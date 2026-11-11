import { readdirSync } from 'fs';
import { join } from 'path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ConflictException, HttpException } from '@nestjs/common';
import { DataSource, type MigrationInterface } from 'typeorm';
import { runInOrganization } from '@libs/logging/correlation-context';
import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
import { PaymentEntity } from './entities/payment.entity';
import { ProviderCredentialEntity } from './entities/provider-credential.entity';
import { LedgerEntryEntity } from './entities/ledger-entry.entity';
import { LedgerService } from '../app/modules/payment/ledger/ledger.service';
import { RefundOutcomeUnknownError } from '../app/modules/payment/payment-provider.interface';

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.ts'))
  .sort()
  .flatMap((file) => Object.values(require(join(MIGRATIONS_DIR, file)) as Record<string, unknown>))
  .filter((exported): exported is new () => MigrationInterface => typeof exported === 'function');

/**
 * Integration test: the payments ledger against a real Postgres -- the refund row lock, the
 * once-per-checkout index only exist in the database (the migration's backfill is tested with the other
 * migrations, in payment.database.int-spec.ts). invoice and the
 * payment providers are stubbed at their boundary.
 */
describe('payments ledger (real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let databases = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
  });

  afterAll(async () => {
    await container?.stop();
  });

  async function freshDataSource() {
    const name = `ledger_${++databases}`;
    const admin = new DataSource({ type: 'postgres', url: container.getConnectionUri() });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.destroy();
    const url = new URL(container.getConnectionUri());
    url.pathname = `/${name}`;
    const dataSource = new DataSource({
      type: 'postgres',
      url: url.toString(),
      entities: [PaymentEntity, ProviderCredentialEntity, LedgerEntryEntity],
      migrations,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    return dataSource;
  }

  /** invoice, as far as the ledger sees it: an issued 1,380.50 BDT invoice that counts entries. */
  const invoiceStub = () => {
    let paidMinor = 0;
    return {
      findOneInvoice: jest.fn(async () => ({
        id: 'inv-1',
        status: 'issued',
        currency: 'BDT',
        total: 1380.5,
        amountPaid: paidMinor / 100,
        balanceDue: Math.max(0, 138_050 - paidMinor) / 100,
      })),
      applyLedgerEntry: jest.fn(async (_id: string, entry: { kind: string; amountMinor: number }) => {
        paidMinor += entry.kind === 'payment' ? entry.amountMinor : -entry.amountMinor;
        return { amountPaid: paidMinor / 100, total: 1380.5 };
      }),
      paidMinor: () => paidMinor,
    };
  };

  const providerStub = (name: 'stripe' | 'sslcommerz', refundsAreIdempotent: boolean) => ({
    name,
    refundsAreIdempotent,
    refund: jest.fn(async () => ({ state: 'pending' as const, providerReference: `${name}-refund-1` })),
    refundStatus: jest.fn(),
  });

  const setup = async () => {
    const dataSource = await freshDataSource();
    const invoice = invoiceStub();
    const sslcommerz = providerStub('sslcommerz', false);
    const stripe = providerStub('stripe', true);
    const registry = { byName: (name: string) => (name === 'stripe' ? stripe : sslcommerz) };
    const ledger = new LedgerService(
      dataSource.getRepository(LedgerEntryEntity),
      dataSource,
      invoice as never,
      registry as never,
    );
    return { dataSource, invoice, sslcommerz, stripe, ledger, entries: dataSource.getRepository(LedgerEntryEntity) };
  };

  const gatewayPayment = (dataSource: DataSource, provider = 'sslcommerz') =>
    dataSource.getRepository(PaymentEntity).save({
      organizationId: ORG,
      invoiceId: 'inv-1',
      provider,
      providerSessionId: `einv${Math.random().toString(16).slice(2, 12)}`,
      // Settled: an invoice has at most one open (pending) checkout.
      status: 'paid',
      amount: 1380.5,
      currency: 'BDT',
    });

  it('records manual part-payments up to the balance, each counted on the invoice once', async () => {
    const { dataSource, invoice, ledger } = await setup();
    try {
      const first = await ledger.recordManual('inv-1', {
        amount: 1000,
        method: 'bank_transfer',
        occurredAt: '2026-10-20',
        reference: 'DBBL-TT-1',
      });
      expect(first).toMatchObject({
        kind: 'payment',
        state: 'settled',
        applyState: 'applied',
        amount: 1000,
        refundedAmount: 0,
      });
      expect(invoice.paidMinor()).toBe(100_000);

      await expect(
        ledger.recordManual('inv-1', { amount: 380.51, method: 'cash', occurredAt: '2026-10-21' }),
      ).rejects.toThrow('৳380.51 is more than the balance due (৳380.50).');

      await ledger.recordManual('inv-1', { amount: 380.5, method: 'cash', occurredAt: '2026-10-21' });
      expect(invoice.paidMinor()).toBe(138_050);
    } finally {
      await dataSource.destroy();
    }
  });

  // SSLCommerz accepts refunds beyond the transaction's total (probed): the ledger is what stops it.
  it('lets concurrent refunds of one payment through only while they fit, under a row lock', async () => {
    const { dataSource, ledger, entries } = await setup();
    try {
      const payment = await ledger.recordManual('inv-1', {
        amount: 1000,
        method: 'bank_transfer',
        occurredAt: '2026-10-20',
      });

      // Five refunds of 300 race; only three fit into 1,000.
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          ledger.refund('inv-1', { paymentEntryId: payment.id, amount: 300, reason: 'Returned in cash' }),
        ),
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
      const refused = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
      expect(refused.map((result) => (result.reason as Error).message)).toEqual([
        'At most ৳100.00 of this payment can still be refunded.',
        'At most ৳100.00 of this payment can still be refunded.',
      ]);
      expect(await entries.count({ where: { kind: 'refund' } })).toBe(3);
    } finally {
      await dataSource.destroy();
    }
  });

  it('refunds an online payment through its provider: pending until settled, then off the invoice', async () => {
    const { dataSource, invoice, sslcommerz, ledger, entries } = await setup();
    try {
      const payment = await runInOrganization(ORG, async () => {
        const checkout = await gatewayPayment(dataSource);
        const entry = await ledger.recordGatewayPayment(checkout, { providerReference: 'BANK1' });
        await ledger.apply(entry);
        return entry;
      });
      expect(invoice.paidMinor()).toBe(138_050);

      const refund = await ledger.refund('inv-1', { paymentEntryId: payment.id, amount: 100, reason: 'Overpaid' });

      expect(sslcommerz.refund).toHaveBeenCalledWith({
        paymentReference: 'BANK1',
        amount: 100,
        currency: 'BDT',
        refundId: refund.id,
        reason: 'Overpaid',
      });
      const stored = await entries.findOneByOrFail({ id: refund.id });
      expect(stored).toMatchObject({
        state: 'pending',
        providerReference: 'sslcommerz-refund-1',
        applyState: 'pending',
      });
      expect(invoice.paidMinor()).toBe(138_050);

      await ledger.recordRefundState(stored, { state: 'settled', providerReference: 'sslcommerz-refund-1' });

      expect(invoice.paidMinor()).toBe(128_050);
      expect(await entries.findOneByOrFail({ id: refund.id })).toMatchObject({
        state: 'settled',
        applyState: 'applied',
      });
    } finally {
      await dataSource.destroy();
    }
  });

  // A repeated SSLCommerz refund_trans_id refunds twice (probed): an unknown outcome waits for a person.
  it('never retries an SSLCommerz refund whose outcome was lost, but leaves a Stripe one to retry', async () => {
    const { dataSource, sslcommerz, stripe, ledger, entries } = await setup();
    try {
      const [ssl, card] = await runInOrganization(ORG, async () => [
        await ledger.recordGatewayPayment(await gatewayPayment(dataSource, 'sslcommerz'), {
          providerReference: 'BANK1',
        }),
        await ledger.recordGatewayPayment(await gatewayPayment(dataSource, 'stripe'), { providerReference: 'pi_1' }),
      ]);
      sslcommerz.refund.mockRejectedValue(new RefundOutcomeUnknownError('SSLCommerz refund outcome unknown: timeout'));
      stripe.refund.mockRejectedValue(new RefundOutcomeUnknownError('Stripe refund outcome unknown: ECONNRESET'));

      const lost = await ledger.refund('inv-1', { paymentEntryId: ssl.id, amount: 10, reason: 'Duplicate' });
      const retryable = await ledger.refund('inv-1', { paymentEntryId: card.id, amount: 10, reason: 'Duplicate' });

      expect(await entries.findOneByOrFail({ id: lost.id })).toMatchObject({
        state: 'unknown',
        failureReason: 'SSLCommerz refund outcome unknown: timeout',
      });
      expect(await entries.findOneByOrFail({ id: retryable.id })).toMatchObject({
        state: 'pending',
        providerReference: null,
      });
      // Both still count against what can be refunded: an unknown refund may have happened.
      await expect(
        ledger.refund('inv-1', { paymentEntryId: ssl.id, amount: 1380.5, reason: 'All of it' }),
      ).rejects.toThrow('At most ৳1,370.50');
      expect((await ledger.pendingRefunds(10)).map((row) => row.id)).toEqual([retryable.id]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('records a refund of a payment that never counted on the invoice without touching the invoice', async () => {
    const { dataSource, invoice, ledger } = await setup();
    try {
      const held = await runInOrganization(ORG, async () =>
        ledger.recordGatewayPayment(await gatewayPayment(dataSource), {
          providerReference: 'BANK1',
          applyState: 'held',
        }),
      );

      const refund = await ledger.refund('inv-1', {
        paymentEntryId: held.id,
        amount: 1380.5,
        reason: 'Refused after review',
        returnedOutsideSystem: true,
      });

      expect(refund).toMatchObject({ state: 'settled', applyState: 'not_applicable' });
      expect(invoice.applyLedgerEntry).not.toHaveBeenCalled();
    } finally {
      await dataSource.destroy();
    }
  });

  it('settles a checkout once however often it is reported, and refuses provider refunds of pre-ledger payments', async () => {
    const { dataSource, ledger, entries } = await setup();
    try {
      await runInOrganization(ORG, async () => {
        const checkout = await gatewayPayment(dataSource);
        const results = await Promise.all(
          Array.from({ length: 5 }, () => ledger.recordGatewayPayment(checkout, { providerReference: 'BANK1' })),
        );
        expect(new Set(results.map((entry) => entry.id)).size).toBe(1);
        expect(await entries.count({ where: { paymentId: checkout.id } })).toBe(1);

        // No provider reference: it predates the ledger.
        const legacy = await ledger.recordGatewayPayment(await gatewayPayment(dataSource), {});
        await expect(
          ledger.refund('inv-1', { paymentEntryId: legacy.id, amount: 10, reason: 'Duplicate' }),
        ).rejects.toThrow(/predates the payments ledger/);
        await expect(
          ledger.refund('inv-1', {
            paymentEntryId: legacy.id,
            amount: 10,
            reason: 'Duplicate',
            returnedOutsideSystem: true,
          }),
        ).resolves.toMatchObject({ state: 'settled' });
      });
    } finally {
      await dataSource.destroy();
    }
  });

  it('marks an entry refused when invoice refuses it for good, and leaves it pending when invoice is down', async () => {
    const { dataSource, invoice, ledger, entries } = await setup();
    try {
      await runInOrganization(ORG, async () => {
        const refused = await ledger.recordGatewayPayment(await gatewayPayment(dataSource), {
          providerReference: 'B1',
        });
        invoice.applyLedgerEntry.mockRejectedValueOnce(
          new ConflictException('Cannot apply a payment to an invoice that is cancelled.'),
        );
        await expect(ledger.apply(refused)).resolves.toMatchObject({ outcome: 'refused' });
        expect(await entries.findOneByOrFail({ id: refused.id })).toMatchObject({ applyState: 'refused' });

        const later = await ledger.recordGatewayPayment(await gatewayPayment(dataSource), { providerReference: 'B2' });
        invoice.applyLedgerEntry.mockRejectedValueOnce(new HttpException('invoice unavailable', 503));
        await expect(ledger.apply(later)).resolves.toEqual({ outcome: 'retry' });
        expect((await ledger.pendingApplications(10)).map((row) => row.id)).toEqual([later.id]);
      });
    } finally {
      await dataSource.destroy();
    }
  });
});
