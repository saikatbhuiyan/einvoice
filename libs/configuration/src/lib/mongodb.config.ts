import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

type MongoReadPreference = 'primary' | 'primaryPreferred' | 'secondary' | 'secondaryPreferred' | 'nearest';

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

function inferDatabaseName(uri: string, fallback = ''): string {
  if (!uri) return fallback;

  try {
    const normalized = uri.startsWith('mongodb+srv://')
      ? uri.replace('mongodb+srv://', 'http://')
      : uri.replace('mongodb://', 'http://');
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.replace(/^\//, '').trim();
    return pathname || fallback;
  } catch {
    return fallback;
  }
}

export class MongoDbConfiguration {
  @IsString()
  @IsNotEmpty()
  @Matches(/^mongodb(\+srv)?:\/\//, {
    message: 'MONGODB_URI must start with mongodb:// or mongodb+srv://',
  })
  MONGODB_URI: string;

  @IsString()
  @IsNotEmpty()
  MONGODB_DB_NAME: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  MONGODB_MIN_POOL_SIZE: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  MONGODB_MAX_POOL_SIZE: number;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(120000)
  MONGODB_CONNECT_TIMEOUT_MS: number;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(120000)
  MONGODB_SOCKET_TIMEOUT_MS: number;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(120000)
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: number;

  @Type(() => Number)
  @IsInt()
  @Min(500)
  @Max(60000)
  MONGODB_HEARTBEAT_FREQUENCY_MS: number;

  @IsBoolean()
  MONGODB_RETRY_WRITES: boolean;

  @IsBoolean()
  MONGODB_RETRY_READS: boolean;

  @IsBoolean()
  MONGODB_DIRECT_CONNECTION: boolean;

  @IsString()
  @IsNotEmpty()
  @IsIn(['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'])
  MONGODB_READ_PREFERENCE: MongoReadPreference;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  MONGODB_APP_NAME?: string;

  constructor() {
    this.MONGODB_URI = process.env['MONGODB_URI'] ?? '';
    this.MONGODB_DB_NAME =
      process.env['MONGODB_DB_NAME'] ?? process.env['MONGO_DB'] ?? inferDatabaseName(this.MONGODB_URI, '');
    this.MONGODB_MIN_POOL_SIZE = parseInteger(process.env['MONGODB_MIN_POOL_SIZE'], 2);
    this.MONGODB_MAX_POOL_SIZE = parseInteger(process.env['MONGODB_MAX_POOL_SIZE'], 20);
    this.MONGODB_CONNECT_TIMEOUT_MS = parseInteger(process.env['MONGODB_CONNECT_TIMEOUT_MS'], 10000);
    this.MONGODB_SOCKET_TIMEOUT_MS = parseInteger(process.env['MONGODB_SOCKET_TIMEOUT_MS'], 45000);
    this.MONGODB_SERVER_SELECTION_TIMEOUT_MS = parseInteger(process.env['MONGODB_SERVER_SELECTION_TIMEOUT_MS'], 5000);
    this.MONGODB_HEARTBEAT_FREQUENCY_MS = parseInteger(process.env['MONGODB_HEARTBEAT_FREQUENCY_MS'], 10000);
    this.MONGODB_RETRY_WRITES = parseBoolean(process.env['MONGODB_RETRY_WRITES'], true);
    this.MONGODB_RETRY_READS = parseBoolean(process.env['MONGODB_RETRY_READS'], true);
    this.MONGODB_DIRECT_CONNECTION = parseBoolean(process.env['MONGODB_DIRECT_CONNECTION'], false);
    this.MONGODB_READ_PREFERENCE =
      (process.env['MONGODB_READ_PREFERENCE'] as MongoReadPreference | undefined) ?? 'primary';
    this.MONGODB_APP_NAME = process.env['MONGODB_APP_NAME']?.trim() || 'einvoice-invoice-service';
  }

  get SANITIZED_URI(): string {
    try {
      const normalized = this.MONGODB_URI.startsWith('mongodb+srv://')
        ? this.MONGODB_URI.replace('mongodb+srv://', 'http://')
        : this.MONGODB_URI.replace('mongodb://', 'http://');
      const parsed = new URL(normalized);

      if (parsed.username || parsed.password) {
        parsed.username = parsed.username ? '***' : '';
        parsed.password = parsed.password ? '***' : '';
      }

      const serialized = parsed
        .toString()
        .replace(/^http:\/\//, this.MONGODB_URI.startsWith('mongodb+srv://') ? 'mongodb+srv://' : 'mongodb://');
      return serialized.replace(/\/$/, '');
    } catch {
      return '[invalid-mongodb-uri]';
    }
  }

  get CONNECTION_OPTIONS() {
    return {
      dbName: this.MONGODB_DB_NAME,
      minPoolSize: this.MONGODB_MIN_POOL_SIZE,
      maxPoolSize: this.MONGODB_MAX_POOL_SIZE,
      connectTimeoutMS: this.MONGODB_CONNECT_TIMEOUT_MS,
      socketTimeoutMS: this.MONGODB_SOCKET_TIMEOUT_MS,
      serverSelectionTimeoutMS: this.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
      heartbeatFrequencyMS: this.MONGODB_HEARTBEAT_FREQUENCY_MS,
      retryWrites: this.MONGODB_RETRY_WRITES,
      retryReads: this.MONGODB_RETRY_READS,
      directConnection: this.MONGODB_DIRECT_CONNECTION,
      readPreference: this.MONGODB_READ_PREFERENCE,
      appName: this.MONGODB_APP_NAME,
    };
  }
}
