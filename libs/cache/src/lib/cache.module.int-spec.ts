import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { Cache } from 'cache-manager';
import type Redis from 'ioredis';
import { CacheModule } from './cache.module';
import { REDIS_CLIENT } from './cache.constants';
import { RedisCacheConfiguration } from './cache.config';

// A realistic generated password: every character here is meaningful inside a redis:// URL.
const PASSWORD = 'p@ss:w/rd#1?x';

// cache-manager can retry a broken store indefinitely; fail the assertion instead of the suite timeout.
const within = <T>(promise: Promise<T>, ms = 5_000) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);

/**
 * Integration test: CacheModule's two Redis connections (Keyv-backed CACHE_MANAGER, and the raw
 * ioredis REDIS_CLIENT the health check pings) against a real, password-protected Redis.
 */
describe('CacheModule against real Redis', () => {
  let container: StartedRedisContainer;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').withPassword(PASSWORD).start();

    const config = new RedisCacheConfiguration();
    Object.assign(config, {
      REDIS_HOST: container.getHost(),
      REDIS_PORT: container.getPort(),
      REDIS_PASSWORD: PASSWORD,
      REDIS_DB: 0,
      CACHE_DEFAULT_TTL: 20,
    });

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ CACHE_CONFIG: config })] }),
        CacheModule.forRoot('int'),
      ],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef?.get<Redis>(REDIS_CLIENT).quit();
    await moduleRef?.get<Cache>(CACHE_MANAGER).disconnect();
    await container?.stop();
  });

  it('authenticates the raw REDIS_CLIENT (the connection the health check pings)', async () => {
    await expect(within(moduleRef.get<Redis>(REDIS_CLIENT).ping())).resolves.toBe('PONG');
  });

  // The health check and the cache use separate connections; if only the cache's is broken, the
  // service reports healthy while every cache read silently misses.
  it('authenticates the cache store with the same password', async () => {
    const cache = moduleRef.get<Cache>(CACHE_MANAGER);

    await within(cache.set('greeting', { hello: 'world' }));

    await expect(within(cache.get('greeting'))).resolves.toEqual({ hello: 'world' });
  });

  it('namespaces keys by prefix and applies the default TTL', async () => {
    const cache = moduleRef.get<Cache>(CACHE_MANAGER);
    const redis = moduleRef.get<Redis>(REDIS_CLIENT);
    await within(cache.set('ttl-check', 1));

    const keys = await redis.keys('*ttl-check*');
    expect(keys).toEqual(['int::ttl-check']);
    const ttl = await redis.pttl(keys[0]);
    expect(ttl).toBeGreaterThan(15_000);
    expect(ttl).toBeLessThanOrEqual(20_000);
  });
});
