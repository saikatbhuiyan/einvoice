import { CONFIGURATION, TConfiguration } from '../configuration';
import { Module, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { LoggerMiddleware } from '@libs/middlewares';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { RateLimitModule } from '@libs/rate-limit';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Pass spread object to make nested keys resolvable by ConfigService
      load: [() => ({ ...CONFIGURATION })],
      // Use platform env vars directly in production, ignore .env file
      ignoreEnvFile: CONFIGURATION.IS_PRODUCTION,
    }),
    InvoiceModule,
    RateLimitModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  /**
   * Boot-time escape hatch — prefer injecting ConfigService inside modules.
   */
  static readonly CONFIGURATION: TConfiguration = CONFIGURATION;

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
