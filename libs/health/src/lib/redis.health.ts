import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@libs/cache';
import { HEALTH_CHECK_TIMEOUT_MS } from './health.config';
import { withTimeout } from './with-timeout';

/**
 * Checks the app's *own* Redis client (the one CacheModule provides), not a fresh connection --
 * a new connection succeeding says nothing about whether the one the app actually uses is healthy.
 *
 * ioredis queues commands while disconnected (its offline queue) and replays them on reconnect, so
 * a bare `ping()` against a dead Redis doesn't fail, it waits -- which would make this endpoint hang
 * for as long as Redis is down. Hence the status check first, and the timeout on the ping itself.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async pingCheck(key = 'redis') {
    const indicator = this.healthIndicatorService.check(key);

    if (this.redis.status !== 'ready') {
      return indicator.down({ message: `Redis connection status is "${this.redis.status}"` });
    }

    try {
      const reply = await withTimeout(this.redis.ping(), HEALTH_CHECK_TIMEOUT_MS, 'Redis PING');
      return reply === 'PONG' ? indicator.up() : indicator.down({ message: `Unexpected PING reply "${reply}"` });
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : String(error) });
    }
  }
}
