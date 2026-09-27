import {
  BaseConfiguration,
  loadEnvironmentFiles,
  PostgresConfiguration,
  RedisCacheConfiguration,
} from '@libs/configuration';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

loadEnvironmentFiles();

class Configuration extends BaseConfiguration {
  @ValidateNested()
  @Type(() => PostgresConfiguration)
  POSTGRES_CONFIG: PostgresConfiguration = new PostgresConfiguration();

  @ValidateNested()
  @Type(() => RedisCacheConfiguration)
  CACHE_CONFIG: RedisCacheConfiguration = new RedisCacheConfiguration();
}

// Validated eagerly at module load time
export const CONFIGURATION = new Configuration();
CONFIGURATION.validate();

export type TConfiguration = typeof CONFIGURATION;
