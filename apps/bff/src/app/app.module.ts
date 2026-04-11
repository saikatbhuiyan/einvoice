import { CONFIGURATION, TConfiguration } from '../configuration';
import { Module, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { LoggerMiddleware } from '@libs/middlewares';
import { ClientsModule } from '@nestjs/microservices';
import { buildTcpClientOptions } from '@libs/transports';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Pass spread object to make nested keys resolvable by ConfigService
      load: [() => ({ ...CONFIGURATION })],
      // Use platform env vars directly in production, ignore .env file
      ignoreEnvFile: CONFIGURATION.IS_PRODUCTION,
    }),
    ClientsModule.register([buildTcpClientOptions('INVOICE_SERVICE', Number(process.env.INVOICE_TCP_PORT || 3305))]),
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
