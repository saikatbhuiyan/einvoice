import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RedisCacheConfiguration {
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
  CACHE_DEFAULT_TTL = 20;

  constructor() {
    this.REDIS_HOST = process.env['REDIS_HOST'] ?? 'localhost';
    this.REDIS_PORT = Number(process.env['REDIS_PORT'] ?? 6379);
    this.REDIS_PASSWORD = process.env['REDIS_PASSWORD'] ?? '';
    this.REDIS_DB = Number(process.env['REDIS_DB'] ?? 0);
    this.CACHE_DEFAULT_TTL = Number(process.env['CACHE_DEFAULT_TTL'] ?? 20);
  }
}
