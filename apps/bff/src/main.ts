import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { ALLOWED_HTTP_METHODS } from '@libs/constants';
import { createValidationPipe } from '@libs/shared/utils';
import { AppModule } from './app/app.module';
import { GlobalExceptionFilter } from '@libs/filters';
import {
  ResponseInterceptor,
  RpcExceptionInterceptor,
  RpcLoggingInterceptor,
  TimeoutInterceptor,
} from '@libs/interceptors';
import { setupSwagger } from './app/common/swagger/swagger.setup';

async function bootstrap(): Promise<void> {
  const { CONFIGURATION } = AppModule;
  const { IS_PRODUCTION, IS_DEVELOPMENT, GLOBAL_PREFIX } = CONFIGURATION;
  const { PORT, CORS_ORIGINS, API_VERSION } = CONFIGURATION.APP_CONFIG;

  const app = await NestFactory.create(AppModule, {
    logger: IS_PRODUCTION ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug', 'verbose'],
    bufferLogs: true,
  });

  app.use(helmet());

  const allowedOrigins = CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: IS_DEVELOPMENT ? true : allowedOrigins,
    methods: [...ALLOWED_HTTP_METHODS],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
    credentials: true,
  });

  app.setGlobalPrefix(GLOBAL_PREFIX);

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: API_VERSION.replace(/^v/, ''), // strip leading "v"
  });

  app.useGlobalPipes(createValidationPipe());

  const httpAdapterHost = app.get(HttpAdapterHost);
  const reflector = app.get(Reflector);

  app.useGlobalFilters(new GlobalExceptionFilter(httpAdapterHost));
  app.useGlobalInterceptors(
    new TimeoutInterceptor(reflector),
    new ResponseInterceptor(reflector),
    // RpcLoggingInterceptor checks context.getType() === 'rpc'
    new RpcLoggingInterceptor(),
    new RpcExceptionInterceptor(),
  );

  app.enableShutdownHooks();

  if (!IS_PRODUCTION) {
    setupSwagger(app, {
      apiVersion: API_VERSION,
      globalPrefix: GLOBAL_PREFIX,
      nodeEnv: CONFIGURATION.NODE_ENV,
      port: PORT,
    });
  }

  await app.listen(PORT);

  Logger.log(`🚀 Running on: http://localhost:${PORT}/${GLOBAL_PREFIX}`);
  Logger.log(`   ENV: ${CONFIGURATION.NODE_ENV} | Version: ${API_VERSION}`);
}

bootstrap().catch((error: unknown) => {
  Logger.error('Application failed to start', error instanceof Error ? error.stack : String(error), 'Bootstrap');
  process.exit(1);
});
