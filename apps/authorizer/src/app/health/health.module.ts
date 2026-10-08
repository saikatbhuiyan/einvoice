import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { CacheModule } from '@libs/cache';
import { GrpcHealthController, RedisHealthIndicator } from '@libs/health';
import { HealthController } from './health.controller';

// GrpcHealthController serves grpc.health.v1 on this app's own gRPC server, so bff can check it.
@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: 'json' }), CacheModule.forRoot('authorizer')],
  controllers: [HealthController, GrpcHealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
