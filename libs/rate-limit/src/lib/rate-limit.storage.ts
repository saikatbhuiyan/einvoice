import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import { RATE_LIMIT_STORAGE } from './rate-limit.constants';

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterMs: number;
}

@Injectable()
export class RedisTokenBucketStorage {
  private readonly luaScript: string;

  constructor(@Inject(RATE_LIMIT_STORAGE) private readonly redis: Redis) {
    this.luaScript = fs.readFileSync(path.join(__dirname, 'ratelimit.lua'), 'utf-8');
  }

  async consume(key: string, burst: number, rate: number, cost: number, now?: number): Promise<ConsumeResult> {
    const timestamp = now ?? Date.now();
    const ratePerMs = rate / 1000;

    const result = (await this.redis.eval(
      this.luaScript,
      1,
      key,
      String(burst),
      String(ratePerMs),
      String(timestamp),
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
