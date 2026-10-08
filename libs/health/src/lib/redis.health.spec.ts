import { HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { RedisHealthIndicator } from './redis.health';
import { withTimeout } from './with-timeout';

function buildIndicator(redis: Partial<Redis>) {
  return new RedisHealthIndicator(redis as Redis, new HealthIndicatorService());
}

describe('RedisHealthIndicator', () => {
  it('reports up when the connection is ready and PING returns PONG', async () => {
    const indicator = buildIndicator({ status: 'ready', ping: jest.fn().mockResolvedValue('PONG') });

    await expect(indicator.pingCheck()).resolves.toEqual({ redis: { status: 'up' } });
  });

  it('reports down immediately, without pinging, when the connection is not ready', async () => {
    const ping = jest.fn();
    const indicator = buildIndicator({ status: 'reconnecting', ping });

    const result = await indicator.pingCheck();

    expect(result['redis'].status).toBe('down');
    expect(ping).not.toHaveBeenCalled();
  });

  it('reports down instead of hanging when PING never resolves (ioredis offline queue)', async () => {
    jest.useFakeTimers();
    const indicator = buildIndicator({ status: 'ready', ping: jest.fn(() => new Promise<'PONG'>(() => undefined)) });

    const pending = indicator.pingCheck();
    await jest.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result['redis'].status).toBe('down');
    expect(result['redis']['message']).toMatch(/timed out/);
    jest.useRealTimers();
  });

  it('uses a custom key when given', async () => {
    const indicator = buildIndicator({ status: 'ready', ping: jest.fn().mockResolvedValue('PONG') });

    await expect(indicator.pingCheck('cache')).resolves.toEqual({ cache: { status: 'up' } });
  });
});

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 100, 'fast')).resolves.toBe(42);
  });

  it('rejects with a labeled error when the promise is too slow', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, 'slow thing')).rejects.toThrow(
      'slow thing timed out after 10ms',
    );
  });
});
