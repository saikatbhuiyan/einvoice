import { AppConfiguration, BaseConfiguration } from '@libs/configuration';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

class Configuration extends BaseConfiguration {
  @ValidateNested()
  @Type(() => AppConfiguration)
  APP_CONFIG: AppConfiguration = new AppConfiguration();
}

export const CONFIGURATION = new Configuration();

CONFIGURATION.validate();

export type TConfiguration = typeof CONFIGURATION;
