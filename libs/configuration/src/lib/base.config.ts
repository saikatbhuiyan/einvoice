export class BaseConfiguration {
  NODE_ENV: string;
  IS_DEVELOPMENT: boolean;
  IS_PRODUCTION: boolean;
  IS_TEST: boolean;
  GLOBAL_PREFIX: string;

  constructor() {
    this.NODE_ENV = process.env['NODE_ENV'] || 'development';
    this.IS_DEVELOPMENT = this.NODE_ENV === 'development';
    this.IS_PRODUCTION = this.NODE_ENV === 'production';
    this.IS_TEST = this.NODE_ENV === 'test';
    this.GLOBAL_PREFIX = process.env['GLOBAL_PREFIX'] || 'api/v1';
  }
}
