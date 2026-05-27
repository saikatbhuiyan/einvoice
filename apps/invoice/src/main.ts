import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createValidationPipe } from '@libs/shared/utils';
import { AppModule } from './app/app.module';
import { createTcpServerConfig, ServiceName } from '@libs/transports';
import { RpcExceptionInterceptor, RpcLoggingInterceptor } from '@libs/interceptors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const isProduction = configService.get<boolean>('IS_PRODUCTION');
  const globalPrefix = configService.get<string>('GLOBAL_PREFIX');
  const port = configService.get<number>('APP_CONFIG.PORT');
  const httpPort = Number(process.env['INVOICE_HTTP_PORT'] ?? port ?? 3302);

  app.useLogger(isProduction ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug', 'verbose']);
  app.useGlobalInterceptors(new RpcLoggingInterceptor(), new RpcExceptionInterceptor());
  app.useGlobalPipes(createValidationPipe());

  app.connectMicroservice(createTcpServerConfig(ServiceName.INVOICE), {
    inheritAppConfig: true,
  });

  app.setGlobalPrefix(globalPrefix);

  await app.startAllMicroservices();
  await app.listen(httpPort);
  Logger.log(`🚀 Application is running on: http://localhost:${httpPort}/${globalPrefix}`);
}

bootstrap();
