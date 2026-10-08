import { Controller } from '@nestjs/common';
import { GRPCHealthIndicator, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { BaseHealthController, grpcPeerCheck, RedisHealthIndicator } from '@libs/health';
import { GrpcServiceName } from '@libs/transports';

@Controller('health')
export class HealthController extends BaseHealthController {
  constructor(
    health: HealthCheckService,
    memory: MemoryHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly grpc: GRPCHealthIndicator,
  ) {
    super(health, memory);
  }

  protected override readinessChecks() {
    return [() => this.redis.pingCheck()];
  }

  protected override dependencyChecks() {
    return [grpcPeerCheck(this.grpc, GrpcServiceName.USER_ACCESS_ROLE_QUERY)];
  }
}
