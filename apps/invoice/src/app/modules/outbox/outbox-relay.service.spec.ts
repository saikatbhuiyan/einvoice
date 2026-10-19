import { Types } from 'mongoose';
import type Redis from 'ioredis';
import { OutboxRelay, OUTBOX_LEADER_KEY, type OutboxRelayOptions } from './outbox-relay.service';
import type { OutboxRepository } from './outbox.repository';
import type { OutboxPublisher } from './outbox-publisher';

const OPTIONS: OutboxRelayOptions = { intervalMs: 500, batchSize: 3, leaseMs: 15_000, maxBackoffMs: 4_000 };

const row = (n: number) => ({
  _id: new Types.ObjectId(),
  topic: 'invoice.events',
  key: `inv-${n}`,
  value: { data: { n } },
});

describe('OutboxRelay', () => {
  let outbox: jest.Mocked<
    Pick<OutboxRepository, 'findUnpublished' | 'markPublished' | 'markFailed' | 'oldestUnpublishedAgeSeconds'>
  >;
  let publisher: jest.Mocked<OutboxPublisher>;
  let redis: { eval: jest.Mock };
  let relay: OutboxRelay;

  beforeEach(() => {
    outbox = {
      findUnpublished: jest.fn().mockResolvedValue([]),
      markPublished: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      oldestUnpublishedAgeSeconds: jest.fn().mockResolvedValue(0),
    };
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    redis = { eval: jest.fn().mockResolvedValue(1) }; // holds the lease
    relay = new OutboxRelay(outbox as never, publisher, redis as unknown as Redis, OPTIONS);
  });

  afterEach(async () => {
    await relay.onApplicationShutdown();
    jest.useRealTimers();
  });

  describe('tick', () => {
    it('publishes the oldest unpublished events in order and stamps each one published', async () => {
      const rows = [row(1), row(2)];
      outbox.findUnpublished.mockResolvedValue(rows as never);
      const order: string[] = [];
      publisher.publish.mockImplementation(async (_t, key) => void order.push(`publish ${key}`));
      outbox.markPublished.mockImplementation(async (id) => void order.push(`mark ${id.toHexString()}`));

      await expect(relay.tick()).resolves.toBe(2);

      expect(outbox.findUnpublished).toHaveBeenCalledWith(3);
      expect(publisher.publish).toHaveBeenNthCalledWith(1, 'invoice.events', 'inv-1', { data: { n: 1 } });
      // Each event is marked only after the broker acknowledged *it*.
      expect(order).toEqual([
        'publish inv-1',
        `mark ${rows[0]._id.toHexString()}`,
        'publish inv-2',
        `mark ${rows[1]._id.toHexString()}`,
      ]);
    });

    // A later event for an invoice must never overtake an earlier one that failed.
    it('stops the batch at the first failure, recording it, and publishes nothing after it', async () => {
      const rows = [row(1), row(2), row(3)];
      outbox.findUnpublished.mockResolvedValue(rows as never);
      const kafkaDown = new Error('KafkaJSConnectionError: Connection timeout');
      publisher.publish.mockResolvedValueOnce(undefined).mockRejectedValueOnce(kafkaDown);

      await expect(relay.tick()).rejects.toThrow(`Publishing outbox event ${rows[1]._id.toHexString()} failed`);

      expect(publisher.publish).toHaveBeenCalledTimes(2);
      expect(outbox.markPublished).toHaveBeenCalledTimes(1);
      expect(outbox.markPublished).toHaveBeenCalledWith(rows[0]._id);
      expect(outbox.markFailed).toHaveBeenCalledWith(rows[1]._id, kafkaDown);
    });

    it('does nothing unless it holds the leader lease', async () => {
      redis.eval.mockResolvedValue(0);
      outbox.findUnpublished.mockResolvedValue([row(1)] as never);

      await expect(relay.tick()).resolves.toBe(0);

      expect(outbox.findUnpublished).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('acquires/renews the lease atomically, under its own instance id and lease time', async () => {
      await relay.tick();

      const [script, keys, key, instanceId, leaseMs] = redis.eval.mock.calls[0];
      expect(script).toContain("'NX', 'PX'");
      expect(script).toContain('PEXPIRE');
      expect([keys, key, leaseMs]).toEqual([1, OUTBOX_LEADER_KEY, '15000']);
      expect(instanceId).toMatch(/^.+:\d+:[0-9a-f]{8}$/);
    });
  });

  describe('scheduling', () => {
    const flush = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };

    beforeEach(() => jest.useFakeTimers());

    it('backs off exponentially while failing, capped, and returns to the interval after a success', async () => {
      const ticks: number[] = [];
      outbox.findUnpublished.mockImplementation(async () => {
        ticks.push(Date.now());
        return [row(1)] as never;
      });
      publisher.publish
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValue(undefined);
      jest.spyOn(relay['logger'], 'warn').mockImplementation(() => undefined);
      jest.spyOn(relay['logger'], 'error').mockImplementation(() => undefined);

      relay.onApplicationBootstrap();
      for (let i = 0; i < 7; i++) {
        await jest.advanceTimersToNextTimerAsync();
        await flush();
      }

      const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
      // 1000, 2000, 4000 (capped at maxBackoffMs), 4000, then success -> back to 500.
      expect(gaps.slice(0, 5)).toEqual([1000, 2000, 4000, 4000, 500]);
    });

    it('drains again immediately after a full batch', async () => {
      const ticks: number[] = [];
      outbox.findUnpublished.mockImplementation(async () => {
        ticks.push(Date.now());
        return (ticks.length === 1 ? [row(1), row(2), row(3)] : []) as never;
      });

      relay.onApplicationBootstrap();
      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersToNextTimerAsync();
        await flush();
      }

      expect(ticks[1] - ticks[0]).toBe(0);
      expect(ticks[2] - ticks[1]).toBe(500);
    });

    it('stops scheduling on shutdown and releases the lease only if it holds it', async () => {
      relay.onApplicationBootstrap();
      await relay.onApplicationShutdown();
      const callsAtShutdown = outbox.findUnpublished.mock.calls.length;

      await jest.advanceTimersByTimeAsync(10_000);

      expect(outbox.findUnpublished.mock.calls.length).toBe(callsAtShutdown);
      const release = redis.eval.mock.calls.at(-1);
      expect(release?.[0]).toContain("redis.call('DEL', KEYS[1])");
      expect(release?.[0]).toContain('== ARGV[1]');
    });
  });
});
