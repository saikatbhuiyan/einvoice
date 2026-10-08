import { Controller, Inject } from '@nestjs/common';
import { HealthCheckService, HealthIndicatorService, MemoryHealthIndicator } from '@nestjs/terminus';
import { BaseHealthController, HEALTH_CHECK_TIMEOUT_MS, withTimeout } from '@libs/health';
import { STORAGE_PROVIDER, StorageProvider } from '../modules/media/storage-provider.interface';

@Controller('health')
export class HealthController extends BaseHealthController {
  constructor(
    health: HealthCheckService,
    memory: MemoryHealthIndicator,
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {
    super(health, memory);
  }

  protected override readinessChecks() {
    return [
      async () => {
        const indicator = this.healthIndicatorService.check('storage');
        try {
          await withTimeout(this.storage.checkHealth(), HEALTH_CHECK_TIMEOUT_MS, 'Storage health check');
          return indicator.up();
        } catch (error) {
          return indicator.down({ message: error instanceof Error ? error.message : String(error) });
        }
      },
    ];
  }
}
