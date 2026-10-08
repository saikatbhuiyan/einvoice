import { Controller } from '@nestjs/common';
import {
  HealthCheckService,
  MemoryHealthIndicator,
  MicroserviceHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { BaseHealthController, tcpPeerCheck } from '@libs/health';
import { ServiceName } from '@libs/transports';

@Controller('health')
export class HealthController extends BaseHealthController {
  constructor(
    health: HealthCheckService,
    memory: MemoryHealthIndicator,
    private readonly typeorm: TypeOrmHealthIndicator,
    private readonly microservice: MicroserviceHealthIndicator,
  ) {
    super(health, memory);
  }

  protected override readinessChecks() {
    return [() => this.typeorm.pingCheck('postgres')];
  }

  protected override dependencyChecks() {
    return [tcpPeerCheck(this.microservice, ServiceName.INVOICE)];
  }
}
