import { Global, Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CONFIGURATION } from '../configuration';
import { PaymentEntity } from './entities/payment.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      // Reads the CONFIGURATION singleton directly rather than injecting a DI token for it --
      // same lesson as apps/product's PostgresModule: a token provided only by AppModule would be
      // invisible here, since this module is imported *by* AppModule, not the other way around.
      useFactory: () => {
        const config = CONFIGURATION.POSTGRES_CONFIG;
        return {
          type: 'postgres' as const,
          host: config.POSTGRES_HOST,
          port: config.POSTGRES_PORT,
          username: config.POSTGRES_USER,
          password: config.POSTGRES_PASSWORD,
          database: config.POSTGRES_DB,
          entities: [PaymentEntity],
          // Schema is managed by migrations (see data-source.ts + payment:migration:* scripts),
          // never by auto-sync -- run `pnpm payment:migration:run` before starting the app
          // against a fresh database.
          synchronize: false,
          ssl: config.POSTGRES_SSL,
          connectTimeoutMS: config.POSTGRES_CONNECT_TIMEOUT_MS,
          poolSize: config.POSTGRES_POOL_MAX,
          logging: false,
        };
      },
    }),
  ],
})
export class PostgresModule {
  private static readonly logger = new Logger(PostgresModule.name);

  constructor() {
    PostgresModule.logger.log(`Postgres configured: ${CONFIGURATION.POSTGRES_CONFIG.SANITIZED_URL}`);
  }
}
