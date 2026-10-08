import { Controller } from '@nestjs/common';
import { HealthCheckService, HealthIndicatorService, MemoryHealthIndicator } from '@nestjs/terminus';
import { BaseHealthController } from '@libs/health';
import { PdfRendererService } from '../modules/pdf/pdf-renderer.service';

@Controller('health')
export class HealthController extends BaseHealthController {
  constructor(
    health: HealthCheckService,
    memory: MemoryHealthIndicator,
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly pdfRenderer: PdfRendererService,
  ) {
    super(health, memory);
  }

  // Liveness, deliberately: a crashed Chromium is never relaunched in-process, so restarting the
  // container is the only fix -- exactly what a failing liveness check triggers.
  protected override livenessChecks() {
    return [
      async () => {
        const indicator = this.healthIndicatorService.check('chromium');
        return this.pdfRenderer.isBrowserConnected()
          ? indicator.up()
          : indicator.down({ message: 'Chromium browser is not connected' });
      },
    ];
  }
}
