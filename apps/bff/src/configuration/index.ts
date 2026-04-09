import { BaseConfiguration } from '@libs/configuration';

class Configuration extends BaseConfiguration {
  NODE_ENV: string;
  IS_DEVELOPMENT: boolean;
  IS_PRODUCTION: boolean;
  IS_TEST: boolean;
  PORT: number | string;
  GLOBAL_PREFIX = 'api';

  constructor() {
    super();
    this.NODE_ENV = process.env.NODE_ENV || 'development';
    this.IS_DEVELOPMENT = this.NODE_ENV === 'development';
    this.IS_PRODUCTION = this.NODE_ENV === 'production';
    this.IS_TEST = this.NODE_ENV === 'test';
    this.PORT = process.env.PORT || 3300;
  }
}

export const CONFIGURATION = new Configuration();

export type TConfiguration = typeof CONFIGURATION;
