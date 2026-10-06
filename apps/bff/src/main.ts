import { Logger as NestLogger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded, type Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { ALLOWED_HTTP_METHODS, BODY_SIZE_LIMIT, SHUTDOWN_DRAIN_TIMEOUT_MS } from '@libs/constants';
import { createValidationPipe } from '@libs/shared/utils';
import { AppModule } from './app/app.module';
import { GlobalExceptionFilter } from '@libs/filters';
import {
  ResponseInterceptor,
  RpcExceptionInterceptor,
  RpcLoggingInterceptor,
  TimeoutInterceptor,
} from '@libs/interceptors';
import { RateLimitGuard } from '@libs/rate-limit';
import { JwtAuthGuard, PermissionGuard } from '@libs/auth';
import { setupSwagger } from './app/common/swagger/swagger.setup';
import type { TConfiguration } from './configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService<TConfiguration>);
  const isProduction = configService.get('IS_PRODUCTION', { infer: true });
  const isDevelopment = configService.get('IS_DEVELOPMENT', { infer: true });
  const globalPrefix = configService.get('GLOBAL_PREFIX', { infer: true });
  const apiVersion = configService.get('APP_CONFIG.PORT', { infer: true })
    ? configService.get('APP_CONFIG.API_VERSION', { infer: true })
    : 'v1';
  const port = configService.get('APP_CONFIG.PORT', { infer: true });
  const corsOrigins = configService.get('APP_CONFIG.CORS_ORIGINS', { infer: true });
  const nodeEnv = configService.get('NODE_ENV', { infer: true });

  app.use(helmet());
  app.use(
    json({
      limit: BODY_SIZE_LIMIT,
      // Stashes the raw bytes alongside the parsed body for every route -- cheap to always do,
      // and the only way the Stripe webhook route (PaymentController.handleWebhook) can verify
      // Stripe's signature: that check is over the exact bytes Stripe signed, and re-serializing
      // the already-parsed JSON body would not byte-for-byte match what Stripe sent.
      verify: (req: Request & { rawBody?: Buffer }, _res, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));

  const allowedOrigins = corsOrigins
    .split(',')
    .map((o: string) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: isDevelopment ? true : allowedOrigins,
    methods: [...ALLOWED_HTTP_METHODS],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
    credentials: true,
  });

  app.setGlobalPrefix(globalPrefix);

  app.set('trust proxy', 1);

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: apiVersion.replace(/^v/, ''),
  });

  app.useGlobalPipes(createValidationPipe());

  const httpAdapterHost = app.get(HttpAdapterHost);
  const reflector = app.get(Reflector);

  // Order matters: rate-limit first (cheapest check, protects against brute force before any
  // auth work happens), then authentication (populates req.user), then authorization (reads it).
  app.useGlobalGuards(app.get(RateLimitGuard), app.get(JwtAuthGuard), app.get(PermissionGuard));
  app.useGlobalFilters(new GlobalExceptionFilter(httpAdapterHost));
  app.useGlobalInterceptors(
    new LoggerErrorInterceptor(),
    new TimeoutInterceptor(reflector),
    new ResponseInterceptor(reflector),
    new RpcLoggingInterceptor(),
    new RpcExceptionInterceptor(),
  );

  app.enableShutdownHooks();

  if (!isProduction) {
    setupSwagger(app, {
      apiVersion,
      globalPrefix,
      nodeEnv,
      port,
    });
  }

  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`Running on: http://localhost:${port}/${globalPrefix}`);
  logger.log(`ENV: ${nodeEnv} | Version: ${apiVersion}`);

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
