import { BaseConfiguration, loadEnvironmentFiles, PostgresConfiguration } from '@libs/configuration';
import { IsNotEmpty, IsOptional, IsString, IsUrl, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

loadEnvironmentFiles();

class StripeConfiguration {
  @IsString()
  @IsNotEmpty()
  STRIPE_SECRET_KEY: string;

  @IsString()
  @IsNotEmpty()
  STRIPE_WEBHOOK_SECRET: string;

  @IsString()
  @IsNotEmpty()
  STRIPE_SUCCESS_URL: string;

  @IsString()
  @IsNotEmpty()
  STRIPE_CANCEL_URL: string;

  constructor() {
    this.STRIPE_SECRET_KEY = process.env['STRIPE_SECRET_KEY'] ?? '';
    this.STRIPE_WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'] ?? '';
    this.STRIPE_SUCCESS_URL = process.env['STRIPE_SUCCESS_URL'] ?? '';
    this.STRIPE_CANCEL_URL = process.env['STRIPE_CANCEL_URL'] ?? '';
  }
}

/**
 * Organizations' own SSLCommerz stores. Both optional: without them payment still boots and takes
 * Stripe payments; connecting a store or starting an SSLCommerz checkout then answers 503.
 */
class SslCommerzConfiguration {
  /** 32 random bytes, base64: encrypts stored provider secrets (CredentialCipher). */
  @IsOptional()
  @Matches(/^[A-Za-z0-9+/]{43}=$/, { message: 'PAYMENT_CREDENTIALS_KEY must be 32 bytes, base64-encoded' })
  PAYMENT_CREDENTIALS_KEY?: string;

  /**
   * bff's public API base (e.g. https://api.example.com/api/v1): SSLCommerz sends the payer's
   * browser back to it and posts IPNs to it, so it must be reachable from outside.
   */
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  PAYMENT_PUBLIC_BASE_URL?: string;

  constructor() {
    this.PAYMENT_CREDENTIALS_KEY = process.env['PAYMENT_CREDENTIALS_KEY'] || undefined;
    this.PAYMENT_PUBLIC_BASE_URL = process.env['PAYMENT_PUBLIC_BASE_URL']?.replace(/\/+$/, '') || undefined;
  }
}

class Configuration extends BaseConfiguration {
  @ValidateNested()
  @Type(() => PostgresConfiguration)
  POSTGRES_CONFIG: PostgresConfiguration = new PostgresConfiguration();

  @ValidateNested()
  @Type(() => StripeConfiguration)
  STRIPE_CONFIG: StripeConfiguration = new StripeConfiguration();

  @ValidateNested()
  @Type(() => SslCommerzConfiguration)
  SSLCOMMERZ_CONFIG: SslCommerzConfiguration = new SslCommerzConfiguration();
}

// Validated eagerly at module load time
export const CONFIGURATION = new Configuration();
CONFIGURATION.validate();

export type TConfiguration = typeof CONFIGURATION;
