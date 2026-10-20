import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { metrics, type Counter } from '@opentelemetry/api';
import Redis from 'ioredis';
import { REDIS_CLIENT, RedisLease } from '@libs/cache';
import { OutboxRepository } from './outbox.repository';
import { OUTBOX_PUBLISHER, type OutboxPublisher } from './outbox-publisher';

export const OUTBOX_RELAY_OPTIONS = Symbol('OUTBOX_RELAY_OPTIONS');

export interface OutboxRelayOptions {
  /** Delay between ticks when caught up. */
  intervalMs: number;
  batchSize: number;
  /** Leader lease lifetime; renewed every tick, so it must comfortably exceed a tick's duration. */
  leaseMs: number;
  /** Ceiling for the exponential backoff after a failed tick. */
  maxBackoffMs: number;
}

export const DEFAULT_OUTBOX_RELAY_OPTIONS: OutboxRelayOptions = {
  intervalMs: 500,
  batchSize: 100,
  leaseMs: 15_000,
  maxBackoffMs: 30_000,
};

export const OUTBOX_LEADER_KEY = 'svc:outbox:relay:leader';

/**
 * Publishes committed outbox rows to Kafka, oldest first, and stamps them published.
 *
 * - **One relay at a time.** Every instance runs this loop, but only the holder of a Redis lease
 *   publishes. Leadership is a performance and ordering measure, not what makes delivery correct: if
 *   a lease lapses mid-batch and a second instance republishes a row, consumers dedupe on eventId.
 * - **Order.** A batch stops at the first failure, so a later event for an aggregate is never
 *   published ahead of an earlier one that failed.
 * - **At-least-once.** A crash between the broker's ack and `markPublished` republishes that row on
 *   the next tick.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly lease: RedisLease;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  private consecutiveFailures = 0;
  private published: Counter | undefined;

  constructor(
    private readonly outbox: OutboxRepository,
    @Inject(OUTBOX_PUBLISHER) private readonly publisher: OutboxPublisher,
    @Inject(REDIS_CLIENT) redis: Redis,
    @Inject(OUTBOX_RELAY_OPTIONS) private readonly options: OutboxRelayOptions,
  ) {
    this.lease = new RedisLease(redis, OUTBOX_LEADER_KEY, options.leaseMs);
  }

  onApplicationBootstrap(): void {
    this.registerMetrics();
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
    await this.lease.release().catch(() => undefined);
  }

  /**
   * One relay pass. Returns how many events were published. Public so tests (and a manual drain)
   * can drive the relay deterministically without waiting on the timer.
   */
  async tick(): Promise<number> {
    if (!(await this.lease.acquireOrRenew())) return 0;

    const batch = await this.outbox.findUnpublished(this.options.batchSize);
    let published = 0;

    for (const event of batch) {
      try {
        await this.publisher.publish(event.topic, event.key, event.value);
      } catch (error) {
        await this.outbox.markFailed(event._id, error);
        this.published?.add(1, { outcome: 'failure', topic: event.topic });
        throw new OutboxPublishError(event._id.toHexString(), error);
      }
      await this.outbox.markPublished(event._id);
      this.published?.add(1, { outcome: 'success', topic: event.topic });
      published += 1;
    }

    return published;
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
      const published = await this.tick();
      fullBatch = published === this.options.batchSize;
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures += 1;
      // The first failure of a streak is a warning; a stuck relay keeps saying so at error level.
      const log = this.consecutiveFailures > 1 ? 'error' : 'warn';
      this.logger[log](`Outbox relay pass failed (${this.consecutiveFailures} in a row): ${(error as Error).message}`);
    }
    // A full batch means more is probably waiting: go again immediately.
    this.schedule(fullBatch ? 0 : this.nextDelay());
  }

  private nextDelay(): number {
    if (this.consecutiveFailures === 0) return this.options.intervalMs;
    return Math.min(this.options.maxBackoffMs, this.options.intervalMs * 2 ** this.consecutiveFailures);
  }

  // Instruments are created here, not at import time: the metrics API has no proxy provider, so an
  // instrument created before instrumentation.ts registers the SDK would stay a no-op forever.
  private registerMetrics(): void {
    const meter = metrics.getMeter('einvoice-outbox');
    this.published = meter.createCounter('outbox.publish', {
      description: 'Outbox events the relay attempted to publish, by outcome.',
    });
    meter
      .createObservableGauge('outbox.oldest_unpublished_age', {
        description: 'Age of the oldest committed event not yet published to Kafka (relay lag).',
        unit: 's',
      })
      .addCallback(async (result) => {
        try {
          result.observe(await this.outbox.oldestUnpublishedAgeSeconds());
        } catch {
          // A scrape must never fail because Mongo is briefly unreachable; the gap shows as no data.
        }
      });
  }
}

export class OutboxPublishError extends Error {
  constructor(eventId: string, cause: unknown) {
    super(`Publishing outbox event ${eventId} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'OutboxPublishError';
  }
}
