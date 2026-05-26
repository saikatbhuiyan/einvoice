import {
  AppConfiguration,
  BaseConfiguration,
  loadEnvironmentFiles,
  MongoDbConfiguration,
  RedisCacheConfiguration,
} from '@libs/configuration';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

loadEnvironmentFiles();

class Configuration extends BaseConfiguration {
  @ValidateNested()
  @Type(() => AppConfiguration)
  APP_CONFIG: AppConfiguration = new AppConfiguration();

  @ValidateNested()
  @Type(() => MongoDbConfiguration)
  MONGODB_CONFIG: MongoDbConfiguration = new MongoDbConfiguration();

  @ValidateNested()
  @Type(() => RedisCacheConfiguration)
  CACHE_CONFIG: RedisCacheConfiguration = new RedisCacheConfiguration();
}

// Validated eagerly at module load time
export const CONFIGURATION = new Configuration();
CONFIGURATION.validate();

export type TConfiguration = typeof CONFIGURATION;
