import { HttpStatus, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { createTcpServerConfig, ServiceName } from '@libs/transports';
import { RpcExceptionInterceptor, RpcLoggingInterceptor } from '@libs/interceptors';

async function bootstrap() {
  const { CONFIGURATION } = AppModule;
  const { IS_PRODUCTION, GLOBAL_PREFIX } = CONFIGURATION;
  const { PORT } = CONFIGURATION.APP_CONFIG;
  const httpPort = Number(process.env['INVOICE_HTTP_PORT'] ?? PORT ?? 3302);

  const app = await NestFactory.create(AppModule, {
    logger: IS_PRODUCTION ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug', 'verbose'],
    bufferLogs: true,
  });

  app.useGlobalInterceptors(new RpcLoggingInterceptor(), new RpcExceptionInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  );

  app.connectMicroservice(createTcpServerConfig(ServiceName.INVOICE), {
    inheritAppConfig: true,
  });

  app.setGlobalPrefix(GLOBAL_PREFIX);

  await app.startAllMicroservices();
  await app.listen(httpPort);
  Logger.log(`🚀 Application is running on: http://localhost:${httpPort}/${GLOBAL_PREFIX}`);
}

bootstrap();
