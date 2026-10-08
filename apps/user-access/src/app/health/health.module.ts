import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { GrpcHealthController } from '@libs/health';
import { HealthController } from './health.controller';

// GrpcHealthController serves grpc.health.v1 on this app's gRPC server (RoleQueryService), so
// authorizer can check it with the standard protocol.
@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: 'json' })],
  controllers: [HealthController, GrpcHealthController],
})
export class HealthModule {}
