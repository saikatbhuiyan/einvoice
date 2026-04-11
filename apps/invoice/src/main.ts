import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { buildTcpMicroserviceOptions } from '@libs/transports';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.connectMicroservice(buildTcpMicroserviceOptions(Number(process.env.INVOICE_TCP_PORT || 3305)));
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = Number(process.env.INVOICE_SERVICE_PORT || 3301);

  await app.startAllMicroservices();
  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
