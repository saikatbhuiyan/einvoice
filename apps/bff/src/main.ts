import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { GlobalExceptionFilter } from '@libs/filters';
import {
  ResponseInterceptor,
  RpcExceptionInterceptor,
  RpcLoggingInterceptor,
  TimeoutInterceptor,
} from '@libs/interceptors';

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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
    credentials: true,
  });

  app.setGlobalPrefix(GLOBAL_PREFIX);

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: API_VERSION.replace(/^v/, ''), // strip leading "v"
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: 422,
    }),
  );

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
    const swaggerConfig = new DocumentBuilder()
      .setTitle('E-Invoice BFF API')
      .setDescription('Backend-for-Frontend API for E-Invoice platform')
      .setVersion('1.0.0')
      .addTag('bff')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'Authorization',
          description: 'Enter JWT token',
          in: 'header',
        },
        'jwt',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    const docsPath = `${GLOBAL_PREFIX}/docs`;
    SwaggerModule.setup(docsPath, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });

    Logger.log(`📄 Swagger docs: http://localhost:${PORT}/${docsPath}`);
  }

  await app.listen(PORT);

  Logger.log(`🚀 Running on: http://localhost:${PORT}/${GLOBAL_PREFIX}`);
  Logger.log(`   ENV: ${CONFIGURATION.NODE_ENV} | Version: ${API_VERSION}`);
}

bootstrap().catch((error: unknown) => {
  Logger.error('Application failed to start', error instanceof Error ? error.stack : String(error), 'Bootstrap');
  process.exit(1);
});
