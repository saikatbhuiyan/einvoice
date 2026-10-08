import { Controller, UseFilters, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  GRPCHealthIndicator,
  HealthCheckService,
  MemoryHealthIndicator,
  MicroserviceHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '@libs/auth';
import {
  BaseHealthController,
  grpcPeerCheck,
  HealthCheckExceptionFilter,
  RedisHealthIndicator,
  tcpPeerCheck,
} from '@libs/health';
import { SkipResponseWrap } from '@libs/interceptors';
import { SkipRateLimit } from '@libs/rate-limit';
import { GrpcServiceName, ServiceName } from '@libs/transports';

// Public (probes carry no token), unthrottled (a probe hitting a rate limit would read as an
// outage), terminus's own response shape on success *and* failure (SkipResponseWrap +
// HealthCheckExceptionFilter -- otherwise a 503 loses which check failed), and version-neutral
// (/api/health/live, not /api/v1/health/live).
@ApiExcludeController()
@Public()
@SkipRateLimit()
@SkipResponseWrap()
@UseFilters(HealthCheckExceptionFilter)
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController extends BaseHealthController {
  constructor(
    health: HealthCheckService,
    memory: MemoryHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly microservice: MicroserviceHealthIndicator,
    private readonly grpc: GRPCHealthIndicator,
  ) {
    super(health, memory);
  }

  protected override readinessChecks() {
    return [() => this.redis.pingCheck()];
  }

  protected override dependencyChecks() {
    return [
      tcpPeerCheck(this.microservice, ServiceName.INVOICE),
      tcpPeerCheck(this.microservice, ServiceName.PRODUCT),
      tcpPeerCheck(this.microservice, ServiceName.USER),
      tcpPeerCheck(this.microservice, ServiceName.PAYMENT),
      grpcPeerCheck(this.grpc, GrpcServiceName.AUTHORIZER),
    ];
  }
}
