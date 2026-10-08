import { Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorFunction, MemoryHealthIndicator } from '@nestjs/terminus';
import { HEALTH_HEAP_LIMIT_BYTES, HEALTH_RSS_LIMIT_BYTES } from './health.config';

/**
 * Three endpoints with three different consumers, kept deliberately separate:
 *
 * - `live`: is this process itself broken? Memory plus any app-specific "can't recover without a
 *   restart" check. Wired to the container healthcheck, so failing it gets the container restarted.
 * - `ready`: can this service do its job right now? Its own hard dependencies only (its database,
 *   its Redis). Meant for traffic routing, never for restarts -- restarting doesn't fix Redis.
 * - `dependencies`: are the peer services this one calls reachable? Diagnostic only. Never wired to
 *   restarts or routing: if bff's readiness included invoice, an invoice outage would mark bff
 *   unready and take product/user endpoints down with it.
 *
 * Apps subclass this with their own `@Controller('health')` and override the check lists. Every
 * route returns HTTP 503 on failure (terminus throws ServiceUnavailableException), unlike the old
 * hand-rolled invoice endpoint, which reported "down" inside an HTTP 200.
 */
export abstract class BaseHealthController {
  protected constructor(
    protected readonly health: HealthCheckService,
    protected readonly memory: MemoryHealthIndicator,
  ) {}

  protected livenessChecks(): HealthIndicatorFunction[] {
    return [];
  }

  protected readinessChecks(): HealthIndicatorFunction[] {
    return [];
  }

  protected dependencyChecks(): HealthIndicatorFunction[] {
    return [];
  }

  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', HEALTH_HEAP_LIMIT_BYTES),
      () => this.memory.checkRSS('memory_rss', HEALTH_RSS_LIMIT_BYTES),
      ...this.livenessChecks(),
    ]);
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check(this.readinessChecks());
  }

  @Get('dependencies')
  @HealthCheck()
  dependencies() {
    return this.health.check(this.dependencyChecks());
  }
}
