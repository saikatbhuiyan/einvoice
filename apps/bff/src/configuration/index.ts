import {
  AppConfiguration,
  BaseConfiguration,
  loadEnvironmentFiles,
  RedisCacheConfiguration,
} from '@libs/configuration';
import { RateLimitConfiguration } from '@libs/rate-limit';
import { CircuitBreakerConfiguration } from '@libs/circuit-breaker';
import { KeycloakConfiguration } from '@libs/auth';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

loadEnvironmentFiles();

class Configuration extends BaseConfiguration {
  @ValidateNested()
  @Type(() => AppConfiguration)
  APP_CONFIG: AppConfiguration = new AppConfiguration();

  @ValidateNested()
  @Type(() => RedisCacheConfiguration)
  CACHE_CONFIG: RedisCacheConfiguration = new RedisCacheConfiguration();

  @ValidateNested()
  @Type(() => RateLimitConfiguration)
  RATE_LIMIT_CONFIG: RateLimitConfiguration = new RateLimitConfiguration();

  @ValidateNested()
  @Type(() => CircuitBreakerConfiguration)
  CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfiguration = new CircuitBreakerConfiguration();

  @ValidateNested()
  @Type(() => KeycloakConfiguration)
  KEYCLOAK_CONFIG: KeycloakConfiguration = new KeycloakConfiguration();
}

// Validated eagerly at module load time
export const CONFIGURATION = new Configuration();
CONFIGURATION.validate();

export type TConfiguration = typeof CONFIGURATION;
