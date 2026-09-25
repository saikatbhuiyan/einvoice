import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;

  return fallback;
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export class PostgresConfiguration {
  @IsString()
  @IsNotEmpty()
  POSTGRES_HOST: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  POSTGRES_PORT: number;

  @IsString()
  @IsNotEmpty()
  POSTGRES_DB: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_USER: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_PASSWORD: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  POSTGRES_POOL_MAX: number;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(120000)
  POSTGRES_CONNECT_TIMEOUT_MS: number;

  @IsBoolean()
  POSTGRES_SSL: boolean;

  constructor() {
    this.POSTGRES_HOST = process.env['POSTGRES_HOST'] ?? 'localhost';
    this.POSTGRES_PORT = parseInteger(process.env['POSTGRES_PORT'], 5432);
    this.POSTGRES_DB = process.env['POSTGRES_DB'] ?? '';
    this.POSTGRES_USER = process.env['POSTGRES_USER'] ?? '';
    this.POSTGRES_PASSWORD = process.env['POSTGRES_PASSWORD'] ?? '';
    this.POSTGRES_POOL_MAX = parseInteger(process.env['POSTGRES_POOL_MAX'], 10);
    this.POSTGRES_CONNECT_TIMEOUT_MS = parseInteger(process.env['POSTGRES_CONNECT_TIMEOUT_MS'], 10000);
    this.POSTGRES_SSL = parseBoolean(process.env['POSTGRES_SSL'], false);
  }

  get SANITIZED_URL(): string {
    return `postgresql://${this.POSTGRES_USER}:***@${this.POSTGRES_HOST}:${this.POSTGRES_PORT}/${this.POSTGRES_DB}`;
  }
}
