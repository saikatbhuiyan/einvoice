import { Provider } from '@nestjs/common';
import { ConnectOptions } from 'mongoose';
import { CONFIGURATION } from '../configuration';
import { MONGODB_CONFIG_TOKEN, MONGODB_CONNECTION_OPTIONS_TOKEN } from './mongodb.constants';

export const mongoConfigurationProvider: Provider = {
  provide: MONGODB_CONFIG_TOKEN,
  useFactory: () => CONFIGURATION.MONGODB_CONFIG,
};

export const mongoConnectionOptionsProvider: Provider = {
  provide: MONGODB_CONNECTION_OPTIONS_TOKEN,
  inject: [MONGODB_CONFIG_TOKEN],
  useFactory: (mongoConfig: typeof CONFIGURATION.MONGODB_CONFIG): ConnectOptions => ({
    ...mongoConfig.CONNECTION_OPTIONS,
    autoIndex: !CONFIGURATION.IS_PRODUCTION,
    maxConnecting: CONFIGURATION.IS_PRODUCTION ? 4 : 2,
  }),
};

export const mongoProviders: Provider[] = [mongoConfigurationProvider, mongoConnectionOptionsProvider];
