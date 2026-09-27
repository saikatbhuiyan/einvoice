import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from '@libs/logging';
import { CONFIGURATION } from '../configuration';
import { PostgresModule } from '../database/postgres.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RoleModule } from './modules/role/role.module';
import { UserModule } from './modules/user/user.module';
import { RpcPermissionGuard } from '@libs/auth/rpc-permission.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => CONFIGURATION],
      ignoreEnvFile: CONFIGURATION.IS_PRODUCTION,
    }),
    LoggingModule.forRoot({ serviceName: 'user-access' }),
    PostgresModule,
    RoleModule,
    UserModule,
  ],
  controllers: [AppController],
  providers: [AppService, RpcPermissionGuard],
})
export class AppModule {}
