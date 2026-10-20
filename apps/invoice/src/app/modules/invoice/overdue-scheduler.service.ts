import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { metrics, type Counter, type Histogram } from '@opentelemetry/api';
import Redis from 'ioredis';
import { REDIS_CLIENT, RedisLease } from '@libs/cache';
import { runAsSystem } from '@libs/logging/correlation-context';
import { INVOICE_REPOSITORY, IInvoiceRepository, InvoiceRef } from './invoice.repository.interface';
import { InvoiceService } from './invoice.service';
import { startOfUtcDay } from './reminder-schedule';

export const OVERDUE_SCHEDULER_OPTIONS = Symbol('OVERDUE_SCHEDULER_OPTIONS');

export interface OverdueSchedulerOptions {
  /** Delay between passes when caught up. */
  intervalMs: number;
  /** Invoices handled per scan; a full batch means more are waiting, so the next pass starts at once. */
  batchSize: number;
  /**
   * Leader lease lifetime. Renewed before every invoice, so it only has to outlive handling one --
   * and it bounds failover: a leader that dies without releasing it (a crash, a SIGKILL) blocks
   * the scheduler for at most this long.
   */
  leaseMs: number;
}

export function overdueSchedulerOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): OverdueSchedulerOptions {
  const intervalMs = Number(env['OVERDUE_SCAN_INTERVAL_MS'] ?? 15 * 60 * 1000);
  return {
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 15 * 60 * 1000,
    batchSize: 100,
    leaseMs: 60 * 1000,
  };
}

export const OVERDUE_LEADER_KEY = 'svc:overdue:leader';

/** Who the work is attributed to (audit `system:overdue-job`), and the least it needs to do it. */
export const OVERDUE_JOB = {
  actor: 'overdue-job',
  permissions: ['invoice:read', 'invoice:write'],
} as const;

export interface OverduePassResult {
  marked: number;
  reminded: number;
  skipped: number;
  failed: number;
}

/**
 * Marks issued invoices overdue once their due date has passed, and sends payment reminders on each
 * organization's schedule. Every invoice instance runs the loop; only the holder of a Redis lease
 * works (one pass at a time keeps load predictable). Correctness doesn't depend on the lease: each
 * step is a conditional write, so an overlapping pass can't mark or remind twice.
 *
 * The scans are across organizations (system work); each invoice is then handled inside
 * runAsSystem for *its* organization, so every query, cache key, audit entry and downstream call
 * (rendering a missing PDF) is scoped exactly as a user's would be. One invoice failing never stops
 * the pass -- it is logged and retried next pass.
 */
@Injectable()
export class OverdueScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OverdueScheduler.name);
  private readonly lease: RedisLease;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  private handled: Counter | undefined;
  private passDuration: Histogram | undefined;

  constructor(
    @Inject(INVOICE_REPOSITORY) private readonly invoices: IInvoiceRepository,
    private readonly invoiceService: InvoiceService,
    @Inject(REDIS_CLIENT) redis: Redis,
    @Inject(OVERDUE_SCHEDULER_OPTIONS) private readonly options: OverdueSchedulerOptions,
  ) {
    this.lease = new RedisLease(redis, OVERDUE_LEADER_KEY, options.leaseMs);
  }

  onApplicationBootstrap(): void {
    // Created here, not at import: the metrics API has no proxy provider (see OutboxRelay).
    const meter = metrics.getMeter('einvoice-overdue');
    this.handled = meter.createCounter('invoice.overdue.handled', {
      description: 'Invoices the overdue scheduler handled, by outcome (marked, reminded, skipped, failed).',
    });
    this.passDuration = meter.createHistogram('invoice.overdue.pass.duration', {
      description: 'Duration of one overdue scheduler pass.',
      unit: 'ms',
    });
    this.schedule(this.options.intervalMs);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
    await this.lease.release().catch(() => undefined);
  }

  /**
   * One pass: mark what became overdue, then send the reminders that are due. Public so tests (and
   * an operator) can drive it deterministically. Returns what it did; nothing if not the leader.
   */
  async tick(now = new Date()): Promise<OverduePassResult & { fullBatch: boolean }> {
    const result: OverduePassResult = { marked: 0, reminded: 0, skipped: 0, failed: 0 };
    if (!(await this.lease.acquireOrRenew())) return { ...result, fullBatch: false };

    const started = Date.now();
    const pastDue = await this.invoices.findPastDueIssued(startOfUtcDay(now), this.options.batchSize);
    for (const invoice of pastDue) {
      if (!(await this.lease.acquireOrRenew())) return this.lostLease(result, started);
      const marked = await this.handle(invoice, 'mark overdue', () => this.invoiceService.markOverdue(invoice.id, now));
      if (marked === undefined) result.failed += 1;
      else if (marked) result.marked += 1;
    }

    const due = await this.invoices.findDueReminders(now, this.options.batchSize);
    for (const invoice of due) {
      if (!(await this.lease.acquireOrRenew())) return this.lostLease(result, started);
      const outcome = await this.handle(invoice, 'send reminder', () =>
        this.invoiceService.sendDueReminder(invoice.id, now),
      );
      if (outcome === undefined) result.failed += 1;
      else if (outcome === 'sent') result.reminded += 1;
      else if (outcome === 'skipped') result.skipped += 1;
    }

    this.record(result, Date.now() - started);
    const fullBatch = pastDue.length === this.options.batchSize || due.length === this.options.batchSize;
    return { ...result, fullBatch };
  }

  /**
   * Another instance took over mid-pass (this one stalled past the lease): stop, rather than run
   * alongside the new leader. Its conditional writes would make that harmless, but not free.
   */
  private lostLease(result: OverduePassResult, started: number): OverduePassResult & { fullBatch: boolean } {
    this.logger.warn('Lost the overdue scheduler lease mid-pass; leaving the rest to the new leader.');
    this.record(result, Date.now() - started);
    return { ...result, fullBatch: false };
  }

  /** Runs one invoice's work as the system in its organization; undefined if it failed. */
  private async handle<T>(invoice: InvoiceRef, what: string, work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await runAsSystem(
        { actor: OVERDUE_JOB.actor, organizationId: invoice.organizationId, permissions: [...OVERDUE_JOB.permissions] },
        work,
      );
    } catch (error) {
      this.logger.error(
        `Could not ${what} for invoice ${invoice.id} (organization ${invoice.organizationId}); retrying next pass: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  private record(result: OverduePassResult, durationMs: number): void {
    for (const [outcome, count] of Object.entries(result)) {
      if (count > 0) this.handled?.add(count, { outcome });
    }
    this.passDuration?.record(durationMs);
    if (result.marked || result.reminded || result.skipped || result.failed) {
      this.logger.log(
        `Overdue pass: ${result.marked} marked overdue, ${result.reminded} reminded, ${result.skipped} reminders skipped (too late), ${result.failed} failed`,
      );
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.runOnce().finally(() => (this.running = undefined));
    }, delayMs);
  }

  private async runOnce(): Promise<void> {
    let fullBatch = false;
    try {
      fullBatch = (await this.tick()).fullBatch;
    } catch (error) {
      this.logger.error(`Overdue pass failed: ${(error as Error).message}`);
    }
    this.schedule(fullBatch ? 0 : this.options.intervalMs);
  }
}
