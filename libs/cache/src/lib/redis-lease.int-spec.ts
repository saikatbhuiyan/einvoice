import Redis from 'ioredis';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { RedisLease } from './redis-lease';

/**
 * Integration test: RedisLease against a real Redis. Its guarantees live in the Lua scripts'
 * atomicity and in key expiry, neither of which a mocked client can show.
 */
describe('RedisLease against real Redis', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let n = 0;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis(container.getConnectionUrl());
  });

  afterAll(async () => {
    await redis?.quit();
    await container?.stop();
  });

  // Two "processes" contending for one key.
  const pair = (ttlMs = 5_000) => {
    const key = `lease-${++n}`;
    return [new RedisLease(redis, key, ttlMs), new RedisLease(redis, key, ttlMs)] as const;
  };

  it('lets exactly one holder lead, and keeps it with that holder while it renews', async () => {
    const [a, b] = pair();

    expect(await a.acquireOrRenew()).toBe(true);
    expect(await b.acquireOrRenew()).toBe(false);
    expect(await a.acquireOrRenew()).toBe(true);
    expect(await b.acquireOrRenew()).toBe(false);
  });

  it('grants exactly one of many simultaneous attempts', async () => {
    const key = `lease-${++n}`;
    const contenders = Array.from({ length: 20 }, () => new RedisLease(redis, key, 5_000));

    const results = await Promise.all(contenders.map((lease) => lease.acquireOrRenew()));

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('renewing extends the expiry', async () => {
    const [a] = pair(1_000);
    await a.acquireOrRenew();
    await redis.pexpire(a.key, 50);

    await a.acquireOrRenew();

    expect(await redis.pttl(a.key)).toBeGreaterThan(500);
  });

  // The holder died: another process takes over once the lease runs out.
  it('passes to another holder once it expires', async () => {
    const [a, b] = pair(150);
    await a.acquireOrRenew();

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await b.acquireOrRenew()).toBe(true);
    expect(await a.acquireOrRenew()).toBe(false);
  });

  it('releases only a lease it holds', async () => {
    const [a, b] = pair();
    await a.acquireOrRenew();

    await b.release();
    expect(await b.acquireOrRenew()).toBe(false);

    await a.release();
    expect(await b.acquireOrRenew()).toBe(true);
  });
});
