import { context, trace } from '@opentelemetry/api';
import { installOtelTestHarness, type OtelTestHarness } from '@libs/telemetry/otel-test-harness';
import { createPinoHttpOptions } from './logging.module';
import {
  extractTraceIdFromTraceparent,
  getCurrentCorrelationContext,
  requireOrganizationId,
  resolveCorrelationContext,
  runAsSystem,
  runInOrganization,
  runWithCorrelationContext,
} from './correlation-context';

describe('correlation context', () => {
  let otel: OtelTestHarness;

  beforeAll(() => {
    otel = installOtelTestHarness();
  });

  afterAll(() => otel.shutdown());

  it("prefers the active OpenTelemetry span's trace id over trace headers", () => {
    const span = trace.getTracer('test').startSpan('http request');
    const resolved = context.with(trace.setSpan(context.active(), span), () =>
      resolveCorrelationContext({
        'x-correlation-id': 'request-123',
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      }),
    );
    span.end();

    expect(resolved).toEqual({ correlationId: 'request-123', traceId: span.spanContext().traceId });
  });

  it('falls back to the traceparent header, then the correlation id, without an active span', () => {
    expect(
      resolveCorrelationContext({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' }).traceId,
    ).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(resolveCorrelationContext({ 'x-correlation-id': 'request-123' }).traceId).toBe('request-123');
  });

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

  describe('runInOrganization', () => {
    it('keeps the surrounding ids and caller, sets the organization, and leaves the outer context alone', () => {
      runWithCorrelationContext({ correlationId: 'c-1', traceId: 't-1', sourceService: 'bff' }, () => {
        const inner = runInOrganization('org-a', () => getCurrentCorrelationContext());

        expect(inner).toEqual({ correlationId: 'c-1', traceId: 't-1', sourceService: 'bff', organizationId: 'org-a' });
        expect(() => requireOrganizationId()).toThrow();
      });
    });

    it('starts a context of its own when there is none', () => {
      const inner = runInOrganization('org-a', () => getCurrentCorrelationContext());

      expect(inner).toMatchObject({
        organizationId: 'org-a',
        correlationId: expect.any(String),
        traceId: expect.any(String),
      });
    });
  });

  describe('runAsSystem', () => {
    // A job triggered while a user's request is in context must never act as, or be audited as, that user.
    it('acts as the system with exactly the granted permissions, dropping any user identity', () => {
      runWithCorrelationContext(
        { correlationId: 'c-1', traceId: 't-1', userId: 'kc-1', roles: ['admin'], permissions: ['user:write'] },
        () => {
          const inner = runAsSystem(
            { actor: 'overdue-job', organizationId: 'org-a', permissions: ['invoice:read'] },
            () => getCurrentCorrelationContext(),
          );

          expect(inner).toEqual({
            correlationId: 'c-1',
            traceId: 't-1',
            sourceService: undefined,
            systemActor: 'overdue-job',
            organizationId: 'org-a',
            permissions: ['invoice:read'],
          });
        },
      );
    });
  });
});
