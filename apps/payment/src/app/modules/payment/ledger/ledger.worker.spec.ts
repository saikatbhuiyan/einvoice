import { getCurrentCorrelationContext } from '@libs/logging/correlation-context';
import { LedgerWorker, ledgerWorkerOptionsFromEnv } from './ledger.worker';
import type { LedgerEntryEntity } from '../../../../database/entities/ledger-entry.entity';
import { RefundOutcomeUnknownError } from '../payment-provider.interface';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

const entry = (fields: Partial<LedgerEntryEntity>) =>
  ({
    id: 'e1',
    organizationId: ORG_A,
    kind: 'payment',
    method: 'sslcommerz',
    providerReference: null,
    ...fields,
  }) as LedgerEntryEntity;

describe('LedgerWorker', () => {
  let ledger: Record<
    'pendingApplications' | 'pendingRefunds' | 'apply' | 'recordRefundState' | 'findPaymentOf' | 'executeRefund',
    jest.Mock
  >;
  let provider: { refundsAreIdempotent: boolean; refundStatus: jest.Mock };
  let worker: LedgerWorker;

  beforeEach(() => {
    ledger = {
      pendingApplications: jest.fn().mockResolvedValue([]),
      pendingRefunds: jest.fn().mockResolvedValue([]),
      apply: jest.fn().mockResolvedValue({ outcome: 'applied' }),
      recordRefundState: jest.fn(),
      findPaymentOf: jest.fn(),
      executeRefund: jest.fn(),
    };
    provider = { refundsAreIdempotent: false, refundStatus: jest.fn() };
    worker = new LedgerWorker(ledger as never, { byName: () => provider } as never, { intervalMs: 0, batchSize: 50 });
  });

  it('counts each pending entry in its own organization, and one failing never stops the pass', async () => {
    const seen: Array<string | undefined> = [];
    ledger.pendingApplications.mockResolvedValue([
      entry({ id: 'a' }),
      entry({ id: 'b', organizationId: ORG_B }),
      entry({ id: 'c' }),
    ]);
    ledger.apply.mockImplementation(async (row: LedgerEntryEntity) => {
      seen.push(getCurrentCorrelationContext()?.organizationId);
      if (row.id === 'b') throw new Error('boom');
      return row.id === 'c' ? { outcome: 'retry' } : { outcome: 'applied' };
    });

    await expect(worker.pass()).resolves.toEqual({ applied: 1, refundsChecked: 0 });
    expect(seen).toEqual([ORG_A, ORG_B, ORG_A]);
    expect(ledger.pendingApplications).toHaveBeenCalledWith(50);
  });

  it('asks the provider where a started refund stands, and records it', async () => {
    const refund = entry({ kind: 'refund', providerReference: 'RRF1' });
    ledger.pendingRefunds.mockResolvedValue([refund]);
    provider.refundStatus.mockResolvedValue({ state: 'settled', providerReference: 'RRF1' });

    await expect(worker.pass()).resolves.toEqual({ applied: 0, refundsChecked: 1 });
    expect(provider.refundStatus).toHaveBeenCalledWith('RRF1');
    expect(ledger.recordRefundState).toHaveBeenCalledWith(refund, { state: 'settled', providerReference: 'RRF1' });
  });

  it('repeats a refund call that never answered only for a provider that de-duplicates refunds', async () => {
    const refund = entry({ kind: 'refund' });
    const payment = entry({ id: 'p1', providerReference: 'pi_1' });
    ledger.pendingRefunds.mockResolvedValue([refund]);
    ledger.findPaymentOf.mockResolvedValue(payment);

    await worker.pass();
    expect(ledger.executeRefund).not.toHaveBeenCalled();

    provider.refundsAreIdempotent = true;
    await worker.pass();
    expect(ledger.executeRefund).toHaveBeenCalledWith(refund, payment);
  });

  it('keeps going when a provider cannot say where a refund stands', async () => {
    ledger.pendingRefunds.mockResolvedValue([
      entry({ id: 'r1', kind: 'refund', providerReference: 'RRF1' }),
      entry({ id: 'r2', kind: 'refund', providerReference: 'RRF2' }),
    ]);
    provider.refundStatus
      .mockRejectedValueOnce(new RefundOutcomeUnknownError('SSLCommerz refund status unknown: timeout'))
      .mockResolvedValueOnce({ state: 'pending', providerReference: 'RRF2' });

    await expect(worker.pass()).resolves.toEqual({ applied: 0, refundsChecked: 1 });
    expect(ledger.recordRefundState).toHaveBeenCalledTimes(1);
  });

  it('skips a pass while the previous one is still running', async () => {
    let finish!: () => void;
    ledger.pendingApplications.mockReturnValueOnce(new Promise((resolve) => (finish = () => resolve([]))));

    const first = worker.pass();
    await expect(worker.pass()).resolves.toEqual({ applied: 0, refundsChecked: 0 });
    finish();
    await first;
    expect(ledger.pendingApplications).toHaveBeenCalledTimes(1);
  });

  it('reads its interval from the environment, defaulting to a minute', () => {
    expect(ledgerWorkerOptionsFromEnv({})).toEqual({ intervalMs: 60_000, batchSize: 50 });
    expect(ledgerWorkerOptionsFromEnv({ LEDGER_WORK_INTERVAL_MS: '0' }).intervalMs).toBe(0);
    expect(ledgerWorkerOptionsFromEnv({ LEDGER_WORK_INTERVAL_MS: 'soon' }).intervalMs).toBe(60_000);
  });
});
