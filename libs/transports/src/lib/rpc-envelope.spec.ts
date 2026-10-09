import { context, trace } from '@opentelemetry/api';
import { runWithCorrelationContext } from '@libs/logging';
import { installOtelTestHarness, type OtelTestHarness } from '@libs/telemetry/otel-test-harness';
import { createRpcEnvelope, getRpcMeta, isRpcEnvelope, unwrapRpcPayload } from './rpc-envelope';

describe('RPC envelope', () => {
  let otel: OtelTestHarness;

  beforeAll(() => {
    otel = installOtelTestHarness();
  });

  afterAll(() => otel.shutdown());

  it("carries the active span's W3C trace context, which survives JSON serialization", () => {
    const span = trace.getTracer('test').startSpan('caller');
    const envelope = context.with(trace.setSpan(context.active(), span), () =>
      createRpcEnvelope({ id: 'invoice-1' }, 'bff'),
    );
    span.end();

    const meta = getRpcMeta(JSON.parse(JSON.stringify(envelope)));
    const { traceId, spanId } = span.spanContext();
    expect(meta?.traceparent).toBe(`00-${traceId}-${spanId}-01`);
  });

  it('omits trace context fields entirely when no span is active', () => {
    const envelope = createRpcEnvelope({ id: 'invoice-1' }, 'bff');

    expect(envelope.meta).not.toHaveProperty('traceparent');
    expect(envelope.meta).not.toHaveProperty('tracestate');
  });

  it('wraps payloads with current correlation metadata', () => {
    const envelope = runWithCorrelationContext({ correlationId: 'corr-1', traceId: 'trace-1' }, () =>
      createRpcEnvelope({ id: 'invoice-1' }, 'bff'),
    );

    expect(envelope).toEqual({
      data: { id: 'invoice-1' },
      meta: expect.objectContaining({
        correlationId: 'corr-1',
        traceId: 'trace-1',
        sourceService: 'bff',
      }),
    });
  });

  it('unwraps envelope payloads', () => {
    const envelope = createRpcEnvelope({ id: 'invoice-1' }, 'bff');

    expect(isRpcEnvelope(envelope)).toBe(true);
    expect(unwrapRpcPayload(envelope)).toEqual({ id: 'invoice-1' });
  });

  it('accepts legacy raw payloads', () => {
    const payload = { id: 'invoice-1' };

    expect(isRpcEnvelope(payload)).toBe(false);
    expect(unwrapRpcPayload(payload)).toBe(payload);
  });
});
