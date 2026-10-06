import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from '@libs/logging';
import { RpcPermissionGuard } from '@libs/auth/rpc-permission.guard';
import { CONFIGURATION } from '../configuration';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MediaModule } from './modules/media/media.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => CONFIGURATION],
      ignoreEnvFile: CONFIGURATION.IS_PRODUCTION,
    }),
    LoggingModule.forRoot({ serviceName: 'media' }),
    MediaModule,
  ],
  controllers: [AppController],
  providers: [AppService, RpcPermissionGuard],
})
export class AppModule {}
