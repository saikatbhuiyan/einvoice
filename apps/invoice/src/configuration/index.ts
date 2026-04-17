import { AppConfiguration, BaseConfiguration, loadEnvironmentFiles, MongoDbConfiguration } from '@libs/configuration';
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
}

// Validated eagerly at module load time
export const CONFIGURATION = new Configuration();
CONFIGURATION.validate();

export type TConfiguration = typeof CONFIGURATION;
