import { CONFIGURATION } from '../configuration';
import { Module, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { CorrelationIdMiddleware } from '@libs/middlewares';
import { LoggingModule } from '@libs/logging';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { ProductModule } from './modules/product/product.module';
import { UserModule } from './modules/user/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { RateLimitModule } from '@libs/rate-limit';
import { CircuitBreakerModule } from '@libs/circuit-breaker';
import { KeycloakAuthModule } from '@libs/auth';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Pass spread object to make nested keys resolvable by ConfigService
      load: [() => ({ ...CONFIGURATION })],
      // Use platform env vars directly in production, ignore .env file
      ignoreEnvFile: CONFIGURATION.IS_PRODUCTION,
    }),
    LoggingModule.forRoot({ serviceName: 'bff' }),
    KeycloakAuthModule.forRoot(),
    InvoiceModule,
    ProductModule,
    UserModule,
    AuthModule,
    RateLimitModule.forRoot(),
    CircuitBreakerModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
