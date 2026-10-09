// Must stay the first import -- see instrumentation.ts.
import './instrumentation';
import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { shutdownTelemetry } from '@libs/telemetry';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { BODY_SIZE_LIMIT, SHUTDOWN_DRAIN_TIMEOUT_MS } from '@libs/constants';
import { createValidationPipe } from '@libs/shared/utils';
import { AppModule } from './app/app.module';
import { createTcpServerConfig, ServiceName } from '@libs/transports';
import { RpcExceptionInterceptor, RpcLoggingInterceptor, RpcTracingInterceptor } from '@libs/interceptors';
import { RpcPermissionGuard } from '@libs/auth/rpc-permission.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
  const globalPrefix = configService.get<string>('GLOBAL_PREFIX') as string;
  const port = configService.get<number>('APP_CONFIG.PORT');
  const httpPort = Number(process.env['INVOICE_HTTP_PORT'] ?? port ?? 3302);

  app.use(json({ limit: BODY_SIZE_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));
  app.useGlobalInterceptors(
    // Outermost, so the RPC log lines below are written inside the span (and carry its trace_id).
    new RpcTracingInterceptor(),
    new LoggerErrorInterceptor(),
    new RpcLoggingInterceptor(),
    new RpcExceptionInterceptor(),
  );
  app.useGlobalGuards(app.get(RpcPermissionGuard));
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  app.connectMicroservice(createTcpServerConfig(ServiceName.INVOICE), {
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
    // Flush the last batch of spans before the process goes away.
    await shutdownTelemetry();
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefullyDrain('SIGTERM'));
  process.on('SIGINT', () => gracefullyDrain('SIGINT'));
}

bootstrap().catch((error: unknown) => {
  NestLogger.error('Application failed to start', error instanceof Error ? error.stack : String(error), 'Bootstrap');
  process.exit(1);
});
