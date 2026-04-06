/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { PORT } from '@libs/constants';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = AppModule.CONFIGURATION.GLOBAL_PREFIX;
  app.setGlobalPrefix(globalPrefix);
  const port = AppModule.CONFIGURATION.PORT || PORT;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
