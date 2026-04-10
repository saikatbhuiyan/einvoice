import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AppConfiguration {
  @Type(() => Number)
  @IsInt()
  @IsNotEmpty()
  @Min(1)
  PORT: number;

  /**
   * Comma-separated list of allowed CORS origins.
   * In production: "https://app.example.com,https://admin.example.com"
   * In development: "*"
   */
  @IsString()
  @IsNotEmpty()
  CORS_ORIGINS: string;

  /** API version string exposed in Swagger and URL prefix e.g. "v1" */
  @IsString()
  @IsNotEmpty()
  API_VERSION: string;

  constructor() {
    const rawPort = Number(process.env['PORT']);
    // Guard against NaN — fall back to 0 so @Min(1) catches it cleanly
    this.PORT = Number.isNaN(rawPort) ? 0 : rawPort;
    this.CORS_ORIGINS = process.env['CORS_ORIGINS'] ?? '';
    this.API_VERSION = process.env['API_VERSION'] ?? 'v1';
  }
}
