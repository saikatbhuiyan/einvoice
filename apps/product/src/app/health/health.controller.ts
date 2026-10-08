import { Controller } from '@nestjs/common';
import { HealthCheckService, MemoryHealthIndicator, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { BaseHealthController, RedisHealthIndicator } from '@libs/health';

@Controller('health')
export class HealthController extends BaseHealthController {
  constructor(
    health: HealthCheckService,
    memory: MemoryHealthIndicator,
    private readonly typeorm: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {
    super(health, memory);
  }

  protected override readinessChecks() {
    return [() => this.typeorm.pingCheck('postgres'), () => this.redis.pingCheck()];
  }
}
