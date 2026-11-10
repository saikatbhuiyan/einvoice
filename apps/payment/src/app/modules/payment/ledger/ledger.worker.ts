import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runInOrganization } from '@libs/logging/correlation-context';
import { LedgerService } from './ledger.service';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { RefundOutcomeUnknownError } from '../payment-provider.interface';

export const LEDGER_WORKER_OPTIONS = Symbol('LEDGER_WORKER_OPTIONS');

export interface LedgerWorkerOptions {
  /** 0 disables the loop (tests). */
  intervalMs: number;
  batchSize: number;
}

export function ledgerWorkerOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): LedgerWorkerOptions {
  const interval = Number(env['LEDGER_WORK_INTERVAL_MS'] ?? 60_000);
  return { intervalMs: Number.isFinite(interval) && interval >= 0 ? interval : 60_000, batchSize: 50 };
}

/**
 * Finishes what a request couldn't: counts settled entries invoice hasn't acknowledged (it was down),
 * and follows refunds still in progress at their provider (SSLCommerz refunds are asynchronous).
 *
 * Every instance runs it, with no leader lease: applying is idempotent (invoice ignores an entry it
 * has counted) and so is recording a refund's state. Each entry is handled in its own organization,
 * and one failing never stops the pass.
 */
@Injectable()
export class LedgerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LedgerWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly ledger: LedgerService,
    private readonly providers: PaymentProviderRegistry,
    @Inject(LEDGER_WORKER_OPTIONS) private readonly options: LedgerWorkerOptions,
  ) {}

  onModuleInit(): void {
    if (this.options.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.pass(), this.options.intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass; overlapping passes in one process are skipped. */
  async pass(): Promise<{ applied: number; refundsChecked: number }> {
    if (this.running) return { applied: 0, refundsChecked: 0 };
    this.running = true;
    try {
      return { applied: await this.applyPending(), refundsChecked: await this.followRefunds() };
    } finally {
      this.running = false;
    }
  }

  private async applyPending(): Promise<number> {
    let applied = 0;
    for (const entry of await this.ledger.pendingApplications(this.options.batchSize)) {
      try {
        const result = await runInOrganization(entry.organizationId, () => this.ledger.apply(entry));
        if (result.outcome === 'applied') applied += 1;
      } catch (error) {
        this.logger.error(`Applying ledger entry ${entry.id} failed: ${(error as Error).message}`);
      }
    }
    return applied;
  }

  private async followRefunds(): Promise<number> {
    let checked = 0;
    for (const refund of await this.ledger.pendingRefunds(this.options.batchSize)) {
      try {
        await runInOrganization(refund.organizationId, async () => {
          const provider = this.providers.byName(refund.method);
          if (refund.providerReference) {
            await this.ledger.recordRefundState(refund, await provider.refundStatus(refund.providerReference));
            return;
          }
          // The call itself never answered. Only a provider that de-duplicates refunds may be asked again.
          const payment = await this.ledger.findPaymentOf(refund);
          if (payment && provider.refundsAreIdempotent) await this.ledger.executeRefund(refund, payment);
        });
        checked += 1;
      } catch (error) {
        const level = error instanceof RefundOutcomeUnknownError ? 'warn' : 'error';
        this.logger[level](`Following refund ${refund.id} failed: ${(error as Error).message}`);
      }
    }
    return checked;
  }
}
