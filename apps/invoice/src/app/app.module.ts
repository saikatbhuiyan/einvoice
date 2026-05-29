import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CONFIGURATION } from '../configuration';
import { LoggerMiddleware } from '@libs/middlewares';
import { MongoDbModule } from '../database/mongodb.module';
import { SchemasModule } from '@libs/schemas';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { AuditLogModule } from '@libs/audit-log';

export const APP_CONFIGURATION = Symbol('APP_CONFIGURATION');

const hasReadReplicas = !!CONFIGURATION.MONGODB_CONFIG.MONGODB_READ_URI;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => CONFIGURATION],
      ignoreEnvFile: CONFIGURATION.IS_PRODUCTION,
    }),
    ...MongoDbModule.withReadReplicas(CONFIGURATION.MONGODB_CONFIG),
    MongoDbModule,
    SchemasModule,
    AuditLogModule,
    ...SchemasModule.forReadConnection(hasReadReplicas),
    InvoiceModule.register(hasReadReplicas),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_CONFIGURATION,
      useValue: CONFIGURATION,
    },
  ],
  exports: [APP_CONFIGURATION],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
