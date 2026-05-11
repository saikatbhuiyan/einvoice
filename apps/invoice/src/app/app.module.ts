import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CONFIGURATION, TConfiguration } from '../configuration';
import { LoggerMiddleware } from '@libs/middlewares';
import { MongoDbModule } from '../database/mongodb.module';
import { SchemasModule } from '@libs/schemas';
import { InvoiceModule } from './modules/invoice/invoice.module';

export const APP_CONFIGURATION = Symbol('APP_CONFIGURATION');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => CONFIGURATION],
      ignoreEnvFile: CONFIGURATION.IS_PRODUCTION,
    }),
    MongoDbModule,
    SchemasModule,
    InvoiceModule,
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
  static readonly CONFIGURATION: TConfiguration = CONFIGURATION;

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
