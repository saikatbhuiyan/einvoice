import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from '@libs/logging';
import { CONFIGURATION } from '../configuration';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthorizationModule } from './modules/authorization/authorization.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => CONFIGURATION],
      ignoreEnvFile: CONFIGURATION.IS_PRODUCTION,
    }),
    LoggingModule.forRoot({ serviceName: 'authorizer' }),
    AuthorizationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
