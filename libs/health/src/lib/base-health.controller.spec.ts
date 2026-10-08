import { HealthCheckService, HealthIndicatorFunction, MemoryHealthIndicator } from '@nestjs/terminus';
import { BaseHealthController } from './base-health.controller';

class TestHealthController extends BaseHealthController {
  constructor(
    health: HealthCheckService,
    memory: MemoryHealthIndicator,
    private readonly checks: {
      live?: HealthIndicatorFunction[];
      ready?: HealthIndicatorFunction[];
      deps?: HealthIndicatorFunction[];
    },
  ) {
    super(health, memory);
  }

  protected override livenessChecks() {
    return this.checks.live ?? [];
  }
  protected override readinessChecks() {
    return this.checks.ready ?? [];
  }
  protected override dependencyChecks() {
    return this.checks.deps ?? [];
  }
}

describe('BaseHealthController', () => {
  let health: { check: jest.Mock };
  let memory: { checkHeap: jest.Mock; checkRSS: jest.Mock };

  beforeEach(() => {
    health = { check: jest.fn((checks: HealthIndicatorFunction[]) => Promise.all(checks.map((c) => c()))) };
    memory = {
      checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }),
      checkRSS: jest.fn().mockResolvedValue({ memory_rss: { status: 'up' } }),
    };
  });

  it('live always checks memory, plus any app-specific liveness checks', async () => {
    const extra = jest.fn().mockResolvedValue({ chromium: { status: 'up' } });
    const controller = new TestHealthController(health as never, memory as never, { live: [extra] });

    await controller.live();

    expect(memory.checkHeap).toHaveBeenCalledWith('memory_heap', expect.any(Number));
    expect(memory.checkRSS).toHaveBeenCalledWith('memory_rss', expect.any(Number));
    expect(extra).toHaveBeenCalled();
  });

  it('keeps readiness and dependency checks separate -- a peer check never runs as part of readiness', async () => {
    const ownDb = jest.fn().mockResolvedValue({ postgres: { status: 'up' } });
    const peer = jest.fn().mockResolvedValue({ tcp_invoice: { status: 'up' } });
    const controller = new TestHealthController(health as never, memory as never, { ready: [ownDb], deps: [peer] });

    await controller.ready();
    expect(ownDb).toHaveBeenCalledTimes(1);
    expect(peer).not.toHaveBeenCalled();

    await controller.dependencies();
    expect(peer).toHaveBeenCalledTimes(1);
  });

  it('never runs memory checks as part of readiness', async () => {
    const controller = new TestHealthController(health as never, memory as never, {});

    await controller.ready();

    expect(memory.checkHeap).not.toHaveBeenCalled();
  });
});
