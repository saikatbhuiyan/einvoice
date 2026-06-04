import { IsInt, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RateLimitConfiguration {
  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  REDIS_PORT: number;

  @IsString()
  REDIS_PASSWORD = '';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  REDIS_DB = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_BURST = 30;

  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  RATE_LIMIT_RATE = 2;

  @IsString()
  @IsNotEmpty()
  RATE_LIMIT_KEY_PREFIX = 'ratelimit';

  constructor() {
    this.REDIS_HOST = process.env['REDIS_HOST'] ?? 'localhost';
    this.REDIS_PORT = Number(process.env['REDIS_PORT'] ?? 6379);
    this.REDIS_PASSWORD = process.env['REDIS_PASSWORD'] ?? '';
    this.REDIS_DB = Number(process.env['REDIS_DB'] ?? 0);
    this.RATE_LIMIT_BURST = Number(process.env['RATE_LIMIT_BURST'] ?? 30);
    this.RATE_LIMIT_RATE = Number(process.env['RATE_LIMIT_RATE'] ?? 2);
    this.RATE_LIMIT_KEY_PREFIX = process.env['RATE_LIMIT_KEY_PREFIX'] ?? 'ratelimit';
  }
}
