import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import { BODY_SIZE_LIMIT, SHUTDOWN_DRAIN_TIMEOUT_MS } from '@libs/constants';
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

  app.use(json({ limit: BODY_SIZE_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));
  app.useLogger(isProduction ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug', 'verbose']);
  app.useGlobalInterceptors(new RpcLoggingInterceptor(), new RpcExceptionInterceptor());
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  app.connectMicroservice(createTcpServerConfig(ServiceName.INVOICE), {
    inheritAppConfig: true,
  });

  app.setGlobalPrefix(globalPrefix);

  await app.startAllMicroservices();
  await app.listen(httpPort);
  Logger.log(`🚀 Application is running on: http://localhost:${httpPort}/${globalPrefix}`);

  const gracefullyDrain = async (signal: string) => {
    Logger.log(`Received ${signal}. Starting graceful drain (${SHUTDOWN_DRAIN_TIMEOUT_MS}ms)...`);
    setTimeout(() => {
      Logger.warn('Drain timeout exceeded. Forcing exit.');
      process.exit(1);
    }, SHUTDOWN_DRAIN_TIMEOUT_MS);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefullyDrain('SIGTERM'));
  process.on('SIGINT', () => gracefullyDrain('SIGINT'));
}

bootstrap();
