import type { Response } from 'express';
import type { CorrelatedRequest } from '@libs/shared/types';
import { getCurrentCorrelationContext } from '@libs/logging';
import { CorrelationIdMiddleware } from './correlation-id.middleware';

function run(headers: Record<string, string>) {
  const req = { headers: { ...headers } } as unknown as CorrelatedRequest;
  const responseHeaders: Record<string, string> = {};
  const res = { setHeader: (name: string, value: string) => (responseHeaders[name] = value) } as unknown as Response;
  let contextInsideNext: ReturnType<typeof getCurrentCorrelationContext>;

  new CorrelationIdMiddleware().use(req, res, () => {
    contextInsideNext = getCurrentCorrelationContext();
  });

  return { req, responseHeaders, contextInsideNext: contextInsideNext! };
}

describe('CorrelationIdMiddleware', () => {
  it('reuses an incoming x-correlation-id and echoes it on the response', () => {
    const { req, responseHeaders } = run({ 'x-correlation-id': 'from-client-123' });

    expect(req.correlationId).toBe('from-client-123');
    expect(responseHeaders['x-correlation-id']).toBe('from-client-123');
  });

  it('generates a correlation id when the client sends none, and writes it back onto the request headers', () => {
    const { req, responseHeaders } = run({});

    expect(req.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.headers['x-correlation-id']).toBe(req.correlationId);
    expect(responseHeaders['x-trace-id']).toBe(req.traceId);
  });

  it('runs the rest of the request inside the correlation context, so RpcEnvelopes pick it up', () => {
    const { req, contextInsideNext } = run({ 'x-correlation-id': 'c-1' });

    expect(contextInsideNext).toMatchObject({ correlationId: 'c-1', traceId: req.traceId });
  });

  it('stamps a high-resolution start time for latency logging', () => {
    expect(typeof run({}).req._startTime).toBe('bigint');
  });
});
