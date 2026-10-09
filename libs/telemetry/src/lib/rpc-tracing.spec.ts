import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { installOtelTestHarness, type OtelTestHarness } from './otel-test-harness';
import {
  extractTraceContext,
  injectTraceContext,
  rpcErrorStatus,
  startRpcClientSpan,
  startRpcServerSpan,
} from './rpc-tracing';

describe('rpc-tracing', () => {
  let otel: OtelTestHarness;

  beforeAll(() => {
    otel = installOtelTestHarness();
  });

  afterEach(() => otel.reset());

  afterAll(() => otel.shutdown());

  it('injects nothing when there is no active span', () => {
    expect(injectTraceContext()).toEqual({});
  });

  it('carries one trace across a JSON round trip, parenting the server span on the client span', () => {
    const client = startRpcClientSpan('INVOICE', 'invoice.generatePdf');
    const carrier = context.with(client.context, () => injectTraceContext());

    // What actually crosses Nest's TCP transport: a JSON-serialized packet.
    const received = JSON.parse(JSON.stringify({ meta: carrier })).meta;
    const server = startRpcServerSpan('invoice.generatePdf', received, 'bff');
    server.end();
    client.end();

    const [serverSpan, clientSpan] = otel.spans();
    expect(carrier.traceparent).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-01$/);
    expect(serverSpan.spanContext().traceId).toBe(clientSpan.spanContext().traceId);
    expect(serverSpan.parentSpanContext?.spanId).toBe(clientSpan.spanContext().spanId);
    expect(clientSpan.kind).toBe(SpanKind.CLIENT);
    expect(serverSpan.kind).toBe(SpanKind.SERVER);
    expect(clientSpan.attributes).toMatchObject({
      'rpc.system': 'nestjs_tcp',
      'rpc.service': 'INVOICE',
      'rpc.method': 'invoice.generatePdf',
    });
    expect(serverSpan.attributes).toMatchObject({ 'rpc.method': 'invoice.generatePdf', 'rpc.source_service': 'bff' });
  });

  it('nests a client span under whatever span is active, so multi-hop calls stay in one trace', () => {
    const inbound = startRpcServerSpan('invoice.generatePdf', {}, 'bff');
    const outbound = context.with(inbound.context, () => startRpcClientSpan('PDF_GENERATOR', 'pdf.render'));
    outbound.end();
    inbound.end();

    const [outboundSpan, inboundSpan] = otel.spans();
    expect(outboundSpan.spanContext().traceId).toBe(inboundSpan.spanContext().traceId);
    expect(outboundSpan.parentSpanContext?.spanId).toBe(inboundSpan.spanContext().spanId);
  });

  it('starts a new root trace from an empty carrier instead of attaching to an unrelated active span', () => {
    const unrelated = trace.getTracer('test').startSpan('unrelated');
    const server = context.with(trace.setSpan(context.active(), unrelated), () => startRpcServerSpan('x.y', {}));
    server.end();
    unrelated.end();

    const serverSpan = otel.spans().find((span) => span.name === 'x.y');
    expect(serverSpan?.parentSpanContext).toBeUndefined();
    expect(serverSpan?.spanContext().traceId).not.toBe(unrelated.spanContext().traceId);
  });

  it('ignores a malformed traceparent rather than throwing', () => {
    expect(trace.getSpanContext(extractTraceContext({ traceparent: 'not-a-traceparent' }))).toBeUndefined();
  });

  it('marks a server fault as an error and records error.type', () => {
    const client = startRpcClientSpan('MEDIA', 'media.upload');
    client.end(new Error('connect ECONNREFUSED'));

    const [span] = otel.spans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes['error.type']).toBe('Error');
    expect(span.events.map((event) => event.name)).toContain('exception');
  });

  it("doesn't mark a 4xx-style RPC outcome as a span error, but still labels it", () => {
    const notFound = { getError: () => ({ status: 404, message: 'Invoice not found' }) };
    const client = startRpcClientSpan('INVOICE', 'invoice.findOne');
    client.end(notFound);

    const [span] = otel.spans();
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(span.attributes['error.type']).toBe('404');
  });

  it('ends a span only once', () => {
    const client = startRpcClientSpan('INVOICE', 'invoice.findAll');
    client.end();
    client.end(new Error('late'));

    expect(otel.spans()).toHaveLength(1);
    expect(otel.spans()[0].status.code).toBe(SpanStatusCode.UNSET);
  });

  it('records rpc.client.duration and rpc.server.duration with low-cardinality labels', async () => {
    startRpcClientSpan('PRODUCT', 'product.findAll').end();
    startRpcServerSpan('product.findAll', {}, 'bff').end(new Error('boom'));

    const clientPoints = await otel.histogramPoints('rpc.client.duration');
    const serverPoints = await otel.histogramPoints('rpc.server.duration');

    expect(clientPoints).toContainEqual({
      attributes: { 'rpc.system': 'nestjs_tcp', 'rpc.service': 'PRODUCT', 'rpc.method': 'product.findAll' },
      count: 1,
    });
    expect(serverPoints).toContainEqual({
      attributes: {
        'rpc.system': 'nestjs_tcp',
        'rpc.method': 'product.findAll',
        'rpc.source_service': 'bff',
        'error.type': 'Error',
      },
      count: 1,
    });
  });

  describe('rpcErrorStatus', () => {
    it.each([
      [{ getStatus: () => 409 }, 409],
      [{ getError: () => ({ status: 403 }) }, 403],
      [{ status: 503 }, 503],
      [{ statusCode: 401 }, 401],
      [new Error('plain'), undefined],
      ['string error', undefined],
    ])('reads %p as %p', (error, expected) => {
      expect(rpcErrorStatus(error)).toBe(expected);
    });
  });
});
