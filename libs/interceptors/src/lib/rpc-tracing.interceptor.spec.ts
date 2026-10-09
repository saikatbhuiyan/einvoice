import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { firstValueFrom, defer, from, throwError } from 'rxjs';
import { installOtelTestHarness, type OtelTestHarness } from '@libs/telemetry/otel-test-harness';
import { RpcTracingInterceptor } from './rpc-tracing.interceptor';

const CALLER_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const CALLER_SPAN_ID = '00f067aa0ba902b7';

function rpcContext(data: unknown, pattern = 'invoice.generatePdf'): ExecutionContext {
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({ getData: () => data, getContext: () => ({ getPattern: () => pattern }) }),
    getClass: () => ({ name: 'InvoiceRpcController' }),
    getHandler: () => ({ name: 'generatePdf' }),
  } as unknown as ExecutionContext;
}

function envelope(traceparent?: string) {
  return {
    data: { id: 'inv-1' },
    meta: {
      correlationId: 'corr-1',
      traceId: CALLER_TRACE_ID,
      sourceService: 'bff',
      timestamp: new Date().toISOString(),
      ...(traceparent ? { traceparent } : {}),
    },
  };
}

describe('RpcTracingInterceptor', () => {
  const interceptor = new RpcTracingInterceptor();
  let otel: OtelTestHarness;

  beforeAll(() => {
    otel = installOtelTestHarness();
  });

  afterEach(() => otel.reset());

  afterAll(() => otel.shutdown());

  it("runs the handler inside a SERVER span that continues the caller's trace", async () => {
    let activeInsideHandler: string | undefined;
    // The handler's own async work, after an await, must still see the span as active.
    const handler: CallHandler = {
      handle: () =>
        defer(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          activeInsideHandler = trace.getActiveSpan()?.spanContext().spanId;
          return 'ok';
        }),
    };

    const result = await firstValueFrom(
      interceptor.intercept(rpcContext(envelope(`00-${CALLER_TRACE_ID}-${CALLER_SPAN_ID}-01`)), handler),
    );

    const [span] = otel.spans();
    expect(result).toBe('ok');
    expect(span.name).toBe('invoice.generatePdf');
    expect(span.spanContext().traceId).toBe(CALLER_TRACE_ID);
    expect(span.parentSpanContext?.spanId).toBe(CALLER_SPAN_ID);
    expect(span.attributes['rpc.source_service']).toBe('bff');
    expect(activeInsideHandler).toBe(span.spanContext().spanId);
  });

  it('ends the span with an error status when the handler fails, and rethrows', async () => {
    const handler: CallHandler = { handle: () => throwError(() => new Error('render failed')) };

    await expect(
      firstValueFrom(
        interceptor.intercept(rpcContext(envelope(`00-${CALLER_TRACE_ID}-${CALLER_SPAN_ID}-01`)), handler),
      ),
    ).rejects.toThrow('render failed');

    const [span] = otel.spans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('passes through untouched without a traceparent (e.g. gRPC, which its own instrumentation traces)', async () => {
    const handler: CallHandler = { handle: () => from(['ok']) };

    await expect(firstValueFrom(interceptor.intercept(rpcContext(envelope()), handler))).resolves.toBe('ok');
    await expect(firstValueFrom(interceptor.intercept(rpcContext({ roles: ['admin'] }), handler))).resolves.toBe('ok');
    expect(otel.spans()).toHaveLength(0);
  });

  it('ignores non-RPC contexts', async () => {
    const httpContext = { getType: () => 'http' } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => from(['ok']) };

    await expect(firstValueFrom(interceptor.intercept(httpContext, handler))).resolves.toBe('ok');
    expect(otel.spans()).toHaveLength(0);
  });
});
