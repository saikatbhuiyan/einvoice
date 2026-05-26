import { Provider } from '@nestjs/common';
import { ConnectOptions } from 'mongoose';
import { APP_CONFIGURATION } from '../app/app.module';
import { MONGODB_CONFIG_TOKEN, MONGODB_CONNECTION_OPTIONS_TOKEN } from './mongodb.constants';

export const mongoConfigurationProvider: Provider = {
  provide: MONGODB_CONFIG_TOKEN,
  inject: [APP_CONFIGURATION],
  useFactory: (config: typeof import('../configuration').CONFIGURATION) => config.MONGODB_CONFIG,
};

export const mongoConnectionOptionsProvider: Provider = {
  provide: MONGODB_CONNECTION_OPTIONS_TOKEN,
  inject: [MONGODB_CONFIG_TOKEN, APP_CONFIGURATION],
  useFactory: (
    mongoConfig: (typeof import('../configuration').CONFIGURATION)['MONGODB_CONFIG'],
    config: typeof import('../configuration').CONFIGURATION,
  ): ConnectOptions => ({
    ...mongoConfig.CONNECTION_OPTIONS,
    autoIndex: !config.IS_PRODUCTION,
    maxConnecting: config.IS_PRODUCTION ? 4 : 2,
  }),
};

export const mongoProviders: Provider[] = [mongoConfigurationProvider, mongoConnectionOptionsProvider];
