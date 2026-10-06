import { BaseConfiguration, loadEnvironmentFiles, PostgresConfiguration } from '@libs/configuration';
import { IsNotEmpty, IsString, ValidateNested } from 'class-validator';
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

class Configuration extends BaseConfiguration {
  @ValidateNested()
  @Type(() => PostgresConfiguration)
  POSTGRES_CONFIG: PostgresConfiguration = new PostgresConfiguration();

  @ValidateNested()
  @Type(() => StripeConfiguration)
  STRIPE_CONFIG: StripeConfiguration = new StripeConfiguration();
}

// Validated eagerly at module load time
export const CONFIGURATION = new Configuration();
CONFIGURATION.validate();

export type TConfiguration = typeof CONFIGURATION;
