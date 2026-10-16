import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { RATE_LIMIT_STORAGE } from './rate-limit.constants';
import { RATE_LIMIT_LUA_SCRIPT } from './ratelimit.lua-script';

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterMs: number;
}

@Injectable()
export class RedisTokenBucketStorage {
  private readonly luaScript = RATE_LIMIT_LUA_SCRIPT;

  constructor(@Inject(RATE_LIMIT_STORAGE) private readonly redis: Redis) {}

  async consume(key: string, burst: number, rate: number, cost: number, now?: number): Promise<ConsumeResult> {
    const ratePerMs = rate / 1000;

    const result = (await this.redis.eval(
      this.luaScript,
      1,
      key,
      String(burst),
      String(ratePerMs),
      // Empty → the script uses Redis TIME. Only tests pass an explicit timestamp.
      now === undefined ? '' : String(now),
      String(cost),
    )) as [number, number, number, number];

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      limit: result[2],
      retryAfterMs: result[3],
    };
  }
}
