import { Controller } from '@nestjs/common';
import {
  HealthCheckService,
  MemoryHealthIndicator,
  MicroserviceHealthIndicator,
  MongooseHealthIndicator,
} from '@nestjs/terminus';
import { BaseHealthController, RedisHealthIndicator, tcpPeerCheck } from '@libs/health';
import { ServiceName } from '@libs/transports';

@Controller('health')
export class HealthController extends BaseHealthController {
  constructor(
    health: HealthCheckService,
    memory: MemoryHealthIndicator,
    private readonly mongoose: MongooseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly microservice: MicroserviceHealthIndicator,
  ) {
    super(health, memory);
  }

  protected override readinessChecks() {
    return [() => this.mongoose.pingCheck('mongo'), () => this.redis.pingCheck()];
  }

  protected override dependencyChecks() {
    return [
      tcpPeerCheck(this.microservice, ServiceName.PDF_GENERATOR),
      tcpPeerCheck(this.microservice, ServiceName.MEDIA),
    ];
  }
}
