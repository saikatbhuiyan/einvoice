import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { PORT } from '@libs/constants';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule);
    const globalPrefix = AppModule.CONFIGURATION.GLOBAL_PREFIX;

    app.setGlobalPrefix(globalPrefix);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    app.enableCors({
      origin: '*', // TODO: Change this to the actual origin
    });

    const config = new DocumentBuilder()
      .setTitle('E-Invoice BFF API')
      .setDescription('E-Invoice BFF API description')
      .setVersion('1.0.0')
      .addTag('bff')
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter JWT token',
        in: 'header',
      })
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(`${globalPrefix}/docs`, app, document);

    const port = AppModule.CONFIGURATION.APP_CONFIG.PORT || PORT;
    await app.listen(port);
    Logger.log(`🚀 Application is running on: http://localhost:${port}/${globalPrefix}`);
    Logger.log(`🚀 Swagger documentation is running on: http://localhost:${port}/${globalPrefix}/docs`);
  } catch (error) {
    Logger.error(`Application failed to start: ${error}`);
    process.exit(1);
  }
}

bootstrap();
