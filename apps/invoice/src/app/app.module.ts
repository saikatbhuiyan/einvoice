import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CONFIGURATION, TConfiguration } from '../configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => CONFIGURATION],
      ignoreEnvFile: CONFIGURATION.IS_PRODUCTION,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  static readonly CONFIGURATION: TConfiguration = CONFIGURATION;
}
