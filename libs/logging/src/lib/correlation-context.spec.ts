import { createPinoHttpOptions } from './logging.module';
import { extractTraceIdFromTraceparent, resolveCorrelationContext } from './correlation-context';

describe('correlation context', () => {
  it('reuses x-correlation-id when valid', () => {
    expect(resolveCorrelationContext({ 'x-correlation-id': 'request-123' }).correlationId).toBe('request-123');
  });

  it('falls back to x-request-id', () => {
    expect(resolveCorrelationContext({ 'x-request-id': 'request-456' }).correlationId).toBe('request-456');
  });

  it('generates a UUID when request id headers are missing or invalid', () => {
    const context = resolveCorrelationContext({ 'x-correlation-id': 'not allowed spaces' });

    expect(context.correlationId).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i);
  });

  it('extracts W3C traceparent trace ids', () => {
    expect(extractTraceIdFromTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBe(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    );
  });

  it('configures pino request ids and redaction', () => {
    const options = createPinoHttpOptions({ serviceName: 'test-service' });
    const headers: Record<string, string> = { 'x-request-id': 'request-789' };
    const res = { setHeader: jest.fn() };

    const id = options.genReqId?.({ headers } as never, res as never);

    expect(id).toBe('request-789');
    expect(headers['x-correlation-id']).toBe('request-789');
    expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'request-789');
    expect(JSON.stringify(options.redact)).toContain('authorization');
  });
});
