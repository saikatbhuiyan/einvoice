import { CONFIGURATION, TConfiguration } from './../configuration/index';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => CONFIGURATION],
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  static CONFIGURATION: TConfiguration = CONFIGURATION;
}
