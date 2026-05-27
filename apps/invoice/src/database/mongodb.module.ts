import { DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { READ_DB } from '@libs/constants';
import { MongoDbConfiguration } from '@libs/configuration';
import { MONGODB_CONNECTION_OPTIONS_TOKEN, MONGODB_CONFIG_TOKEN } from './mongodb.constants';
import { mongoProviders } from './mongodb.provider';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [MONGODB_CONFIG_TOKEN, MONGODB_CONNECTION_OPTIONS_TOKEN],
      useFactory: (
        mongoConfig: { MONGODB_URI: string; SANITIZED_URI: string },
        connectionOptions: Record<string, unknown>,
      ) => ({
        uri: mongoConfig.MONGODB_URI,
        ...connectionOptions,
        connectionFactory: (connection: Connection) => {
          const sanitizedUri = mongoConfig.SANITIZED_URI;

          connection.on('connected', () => {
            Logger.log(`MongoDB connected: ${sanitizedUri}`);
          });

          connection.on('disconnected', () => {
            Logger.warn('MongoDB disconnected');
          });

          connection.on('reconnected', () => {
            Logger.log(`MongoDB reconnected: ${sanitizedUri}`);
          });

          connection.on('error', (error: Error) => {
            Logger.error('MongoDB connection error', error.stack);
          });

          return connection;
        },
      }),
    }),
  ],
  providers: [...mongoProviders],
  exports: [...mongoProviders, MongooseModule],
})
export class MongoDbModule {
  static withReadReplicas(mongoConfig: MongoDbConfiguration): DynamicModule[] {
    if (!mongoConfig.MONGODB_READ_URI) {
      return [];
    }

    const readUri = mongoConfig.MONGODB_READ_URI;

    return [
      MongooseModule.forRootAsync({
        connectionName: READ_DB,
        useFactory: () => ({
          uri: readUri,
          ...mongoConfig.CONNECTION_OPTIONS,
          readPreference: mongoConfig.MONGODB_READ_PREFERENCE,
          connectionFactory: (connection: Connection) => {
            const sanitizedReadUri = mongoConfig.SANITIZED_READ_URI;

            connection.on('connected', () => {
              Logger.log(`MongoDB read connection connected: ${sanitizedReadUri}`);
            });

            connection.on('disconnected', () => {
              Logger.warn('MongoDB read connection disconnected');
            });

            connection.on('reconnected', () => {
              Logger.log(`MongoDB read connection reconnected: ${sanitizedReadUri}`);
            });

            connection.on('error', (error: Error) => {
              Logger.error('MongoDB read connection error', error.stack);
            });

            return connection;
          },
        }),
      }),
    ];
  }
}
