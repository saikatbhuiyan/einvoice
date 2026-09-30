import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { SHUTDOWN_DRAIN_TIMEOUT_MS } from '@libs/constants';
import { createGrpcServerConfig, GrpcServiceName } from '@libs/transports';
import { RpcLoggingInterceptor } from '@libs/interceptors';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
  const globalPrefix = configService.get<string>('GLOBAL_PREFIX') ?? 'api';
  const httpPort = Number(process.env['AUTHORIZER_HTTP_PORT'] ?? 3309);

  app.useGlobalInterceptors(new LoggerErrorInterceptor(), new RpcLoggingInterceptor());
  app.enableShutdownHooks();

  app.connectMicroservice(createGrpcServerConfig(GrpcServiceName.AUTHORIZER), {
    inheritAppConfig: true,
  });

  app.setGlobalPrefix(globalPrefix);

  await app.startAllMicroservices();
  await app.listen(httpPort);
  const logger = app.get(Logger);
  logger.log(`Application is running on: http://localhost:${httpPort}/${globalPrefix}`);

  const gracefullyDrain = async (signal: string) => {
    logger.log(`Received ${signal}. Starting graceful drain (${SHUTDOWN_DRAIN_TIMEOUT_MS}ms)...`);
    setTimeout(() => {
      logger.warn('Drain timeout exceeded. Forcing exit.');
      process.exit(1);
    }, SHUTDOWN_DRAIN_TIMEOUT_MS);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefullyDrain('SIGTERM'));
  process.on('SIGINT', () => gracefullyDrain('SIGINT'));
}

bootstrap().catch((error: unknown) => {
  NestLogger.error('Application failed to start', error instanceof Error ? error.stack : String(error), 'Bootstrap');
  process.exit(1);
});
