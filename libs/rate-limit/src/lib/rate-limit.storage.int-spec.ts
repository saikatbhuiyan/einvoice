import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';
import { RedisTokenBucketStorage } from './rate-limit.storage';

/**
 * Integration test: the token-bucket Lua script executed by a real Redis. Mocking `redis.eval`
 * would test nothing about the script itself — its arithmetic, its TTL, or its atomicity.
 */
describe('RedisTokenBucketStorage against real Redis', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let storage: RedisTokenBucketStorage;
  let keyCounter = 0;
  const key = () => `ratelimit:spec:${++keyCounter}`;
  const T0 = 1_700_000_000_000;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis(container.getConnectionUrl());
    storage = new RedisTokenBucketStorage(redis);
  });

  afterAll(async () => {
    await redis?.quit();
    await container?.stop();
  });

  it('allows exactly `burst` requests from a fresh bucket, then rejects', async () => {
    const k = key();
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await storage.consume(k, 5, 1, 1, T0));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([4, 3, 2, 1, 0, 0]);
  });

  it('tells a rejected caller how long until one token is available', async () => {
    const k = key();
    for (let i = 0; i < 2; i++) await storage.consume(k, 2, 2, 1, T0);

    // 2 tokens/s → one token every 500ms.
    await expect(storage.consume(k, 2, 2, 1, T0)).resolves.toMatchObject({ allowed: false, retryAfterMs: 500 });
  });

  it('refills continuously at `rate` tokens per second, capped at burst', async () => {
    const k = key();
    for (let i = 0; i < 4; i++) await storage.consume(k, 4, 2, 1, T0);

    await expect(storage.consume(k, 4, 2, 1, T0 + 1_000)).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(storage.consume(k, 4, 2, 1, T0 + 60_000)).resolves.toMatchObject({ allowed: true, remaining: 3 });
  });

  it('charges `cost` tokens per request', async () => {
    const k = key();

    await expect(storage.consume(k, 10, 1, 4, T0)).resolves.toMatchObject({ allowed: true, remaining: 6 });
    await expect(storage.consume(k, 10, 1, 7, T0)).resolves.toMatchObject({ allowed: false, remaining: 6 });
  });

  it('expires idle buckets once they would be full again, so Redis does not accumulate keys', async () => {
    const k = key();
    await storage.consume(k, 30, 2, 1, T0);

    // 30 tokens at 2/s → full after 15s; the script adds 1s of slack.
    const ttl = await redis.ttl(k);
    expect(ttl).toBeGreaterThan(14);
    expect(ttl).toBeLessThanOrEqual(16);
  });

  // The whole reason this is a Lua script: read-modify-write must be atomic across concurrent
  // requests (and across bff instances sharing one Redis).
  it('never over-admits under concurrency', async () => {
    const k = key();

    const results = await Promise.all(Array.from({ length: 50 }, () => storage.consume(k, 10, 0.001, 1, T0)));

    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  // Every bff instance passes its own Date.now(). If one instance's clock is behind the one that
  // last touched the bucket, `elapsed` is negative — that must not *remove* tokens or rewind the
  // refill clock.
  it('does not penalize a request whose clock is behind the last writer’s (multi-instance skew)', async () => {
    const k = key();
    await storage.consume(k, 10, 2, 1, T0);

    const skewed = await storage.consume(k, 10, 2, 1, T0 - 2_000);

    expect(skewed).toMatchObject({ allowed: true, remaining: 8 });
  });

  it('uses Redis’s own clock when no timestamp is passed (the production path)', async () => {
    const k = key();
    const [seconds] = await redis.time();

    await expect(storage.consume(k, 3, 1, 1)).resolves.toMatchObject({ allowed: true, remaining: 2 });
    await expect(storage.consume(k, 3, 1, 1)).resolves.toMatchObject({ allowed: true, remaining: 1 });

    const lastRefill = Number(await redis.hget(k, 'last_refill'));
    expect(Math.abs(lastRefill - Number(seconds) * 1000)).toBeLessThan(5_000);
  });

  it('does not grant a burst of extra tokens after a skewed request rewinds the clock', async () => {
    const k = key();
    for (let i = 0; i < 10; i++) await storage.consume(k, 10, 2, 1, T0);
    await storage.consume(k, 10, 2, 1, T0 - 5_000);

    // Back on the correct clock, no time has actually passed since the bucket was emptied.
    await expect(storage.consume(k, 10, 2, 1, T0)).resolves.toMatchObject({ allowed: false });
  });
});
