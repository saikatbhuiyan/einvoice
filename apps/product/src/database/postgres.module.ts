import { Global, Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CONFIGURATION } from '../configuration';
import { ProductEntity } from './entities/product.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      // Reads the CONFIGURATION singleton directly rather than injecting a DI token for it:
      // a token provided only by AppModule would be invisible here, since this module is
      // imported *by* AppModule, not the other way around (see apps/invoice's MongoDbModule
      // for the same lesson learned the hard way).
      useFactory: () => {
        const config = CONFIGURATION.POSTGRES_CONFIG;
        return {
          type: 'postgres' as const,
          host: config.POSTGRES_HOST,
          port: config.POSTGRES_PORT,
          username: config.POSTGRES_USER,
          password: config.POSTGRES_PASSWORD,
          database: config.POSTGRES_DB,
          entities: [ProductEntity],
          // Auto-sync the schema outside production, matching the Mongo autoIndex convention
          // used elsewhere in this workspace. Production needs a real migration strategy
          // (TypeORM migrations) before this table is managed by a live deployment.
          synchronize: !CONFIGURATION.IS_PRODUCTION,
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
