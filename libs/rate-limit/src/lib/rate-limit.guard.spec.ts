import { Controller, Get, HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { RateLimit, SkipRateLimit } from './rate-limit.decorator';
import { RateLimitGuard } from './rate-limit.guard';
import type { ConsumeResult, RedisTokenBucketStorage } from './rate-limit.storage';

@Controller()
class Routes {
  @Get('default')
  defaults() {
    return null;
  }

  @RateLimit({ burst: 5, rate: 0.5 })
  @Get('login')
  login() {
    return null;
  }

  @RateLimit({ keyExtractor: 'apiKey' })
  @Get('partner')
  partner() {
    return null;
  }

  @SkipRateLimit()
  @Get('health')
  health() {
    return null;
  }
}

const config = { RATE_LIMIT_BURST: 30, RATE_LIMIT_RATE: 2, RATE_LIMIT_KEY_PREFIX: 'ratelimit' };

function httpContext(method: keyof Routes, request: Record<string, unknown> = {}) {
  const req = {
    ip: '203.0.113.7',
    method: 'GET',
    url: '/api/v1/x?page=2',
    route: { path: '/api/v1/x' },
    headers: {},
    ...request,
  };
  const headers: Record<string, unknown> = {};
  const res = { setHeader: (name: string, value: unknown) => (headers[name] = value) };
  const host = new ExecutionContextHost([req, res, () => undefined], Routes, Routes.prototype[method]);
  host.setType('http');
  return { host, headers };
}

describe('RateLimitGuard', () => {
  let consume: jest.Mock<Promise<ConsumeResult>>;
  let guard: RateLimitGuard;

  beforeEach(() => {
    consume = jest.fn().mockResolvedValue({ allowed: true, remaining: 29, limit: 30, retryAfterMs: 0 });
    const configService = { get: () => config } as unknown as ConfigService;
    guard = new RateLimitGuard(new Reflector(), { consume } as unknown as RedisTokenBucketStorage, configService);
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  afterEach(() => jest.restoreAllMocks());

  it('skips the bucket entirely for @SkipRateLimit() routes', async () => {
    await expect(guard.canActivate(httpContext('health').host)).resolves.toBe(true);
    expect(consume).not.toHaveBeenCalled();
  });

  it('uses the configured defaults and keys the bucket by ip, method and route pattern', async () => {
    await guard.canActivate(httpContext('defaults').host);

    expect(consume).toHaveBeenCalledWith('ratelimit:ip:203.0.113.7:GET:/api/v1/x', 30, 2, 1);
  });

  it('keys by the route pattern, not the raw URL, so query strings cannot mint fresh buckets', async () => {
    await guard.canActivate(httpContext('defaults', { url: '/api/v1/x?bust=1' }).host);
    await guard.canActivate(httpContext('defaults', { url: '/api/v1/x?bust=2' }).host);

    expect(consume.mock.calls[0][0]).toBe(consume.mock.calls[1][0]);
  });

  it('lets a @RateLimit() route override burst and rate', async () => {
    await guard.canActivate(httpContext('login').host);

    expect(consume).toHaveBeenCalledWith(expect.any(String), 5, 0.5, 1);
  });

  it('sets the X-RateLimit headers on allowed requests', async () => {
    const { host, headers } = httpContext('defaults');

    await guard.canActivate(host);

    // 1 token missing at 2 tokens/s → full again in 0.5s.
    expect(headers).toEqual({ 'X-RateLimit-Limit': 30, 'X-RateLimit-Remaining': 29, 'X-RateLimit-Reset': 1001 });
  });

  it('rejects with 429 and a Retry-After rounded up to whole seconds', async () => {
    consume.mockResolvedValue({ allowed: false, remaining: 0, limit: 30, retryAfterMs: 1200 });
    const { host, headers } = httpContext('defaults');

    const attempt = guard.canActivate(host);

    await expect(attempt).rejects.toBeInstanceOf(HttpException);
    await expect(attempt).rejects.toMatchObject({ status: 429 });
    expect(headers['Retry-After']).toBe(2);
  });

  describe('apiKey extractor', () => {
    it('keys by the x-api-key header when present', async () => {
      await guard.canActivate(httpContext('partner', { headers: { 'x-api-key': 'k-123' } }).host);

      expect(consume.mock.calls[0][0]).toBe('ratelimit:apiKey:k-123:GET:/api/v1/x');
    });

    it('accepts an "ApiKey <key>" Authorization header', async () => {
      await guard.canActivate(httpContext('partner', { headers: { authorization: 'ApiKey k-456' } }).host);

      expect(consume.mock.calls[0][0]).toBe('ratelimit:apiKey:k-456:GET:/api/v1/x');
    });

    it('does not treat a Bearer token as an API key, falling back to the ip', async () => {
      await guard.canActivate(httpContext('partner', { headers: { authorization: 'Bearer eyJ...' } }).host);

      expect(consume.mock.calls[0][0]).toBe('ratelimit:apiKey:203.0.113.7:GET:/api/v1/x');
    });
  });
});
