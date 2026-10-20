import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { InternalCallerContextMiddleware } from '@libs/middlewares';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from '@libs/logging';
import { CONFIGURATION } from '../configuration';
import { PostgresModule } from '../database/postgres.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProductModule } from './modules/product/product.module';
import { HealthModule } from './health/health.module';
import { RpcPermissionGuard } from '@libs/auth/rpc-permission.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => CONFIGURATION],
      ignoreEnvFile: CONFIGURATION.IS_PRODUCTION,
    }),
    LoggingModule.forRoot({ serviceName: 'product' }),
    PostgresModule,
    ProductModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, RpcPermissionGuard],
})
export class AppModule implements NestModule {
  // Internal HTTP API: correlation context, plus the organization from X-Organization-Id (trusted
  // here, unlike in bff) so tenant-scoped handlers can run. RPC calls get theirs from RpcMeta.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(InternalCallerContextMiddleware).forRoutes('*');
  }
}
