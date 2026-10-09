// Trace context propagation and RPC metrics for Nest's TCP transport. Imported by subpath
// (`@libs/telemetry/rpc-tracing`) from @libs/transports and @libs/interceptors, so it depends on
// `@opentelemetry/api` only -- never the SDK. With no SDK started, every call here is a cheap no-op.
//
// gRPC and HTTP need none of this: their auto-instrumentations carry `traceparent` in gRPC metadata
// / HTTP headers. Nest's TCP transport has no headers at all -- just a JSON packet -- so the W3C
// trace context rides inside the existing RpcEnvelope's `meta` instead, next to correlationId.
import {
  context,
  metrics,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Histogram,
  type Span,
} from '@opentelemetry/api';

const INSTRUMENTATION_SCOPE = '@libs/telemetry/rpc-tracing';
export const RPC_SYSTEM = 'nestjs_tcp';

/** The two W3C Trace Context fields, as carried in `RpcMeta`. */
export interface TraceCarrier {
  traceparent?: string;
  tracestate?: string;
}

export interface RpcSpanHandle {
  /** The context with this span active -- run the call (client) or handler (server) inside it. */
  readonly context: Context;
  readonly span: Span;
  /** Ends the span and records its duration. Idempotent; pass the error if the call failed. */
  end(error?: unknown): void;
}

let durations: { client: Histogram; server: Histogram } | undefined;

// Created on first use, not at module load: the metrics API (unlike tracing's) has no proxy
// provider, so an instrument created before the SDK registers its MeterProvider stays a no-op
// forever. By the first RPC call, instrumentation.ts has long since started the SDK.
function rpcDurations() {
  if (!durations) {
    const meter = metrics.getMeter(INSTRUMENTATION_SCOPE);
    durations = {
      client: meter.createHistogram('rpc.client.duration', {
        description: 'Duration of outbound TCP RPC calls, as seen by the caller.',
        unit: 'ms',
      }),
      server: meter.createHistogram('rpc.server.duration', {
        description: 'Duration of inbound TCP RPC calls, as seen by the handling service.',
        unit: 'ms',
      }),
    };
  }
  return durations;
}

/** Serializes `ctx` (default: the active one) into W3C fields, or `{}` when there's no trace. */
export function injectTraceContext(ctx: Context = context.active()): TraceCarrier {
  const carrier: Record<string, string> = {};
  propagation.inject(ctx, carrier);

  const result: TraceCarrier = {};
  if (carrier['traceparent']) result.traceparent = carrier['traceparent'];
  if (carrier['tracestate']) result.tracestate = carrier['tracestate'];
  return result;
}

/**
 * Parses the W3C fields back into a context. Starts from ROOT_CONTEXT, not the active one: the
 * caller's trace is the only legitimate parent of an inbound call's span.
 */
export function extractTraceContext(carrier: TraceCarrier): Context {
  return propagation.extract(ROOT_CONTEXT, { ...carrier });
}

/**
 * Starts the caller's span for one `ClientProxy.send()`. Build the RpcEnvelope inside
 * `handle.context` so the `traceparent` it carries points at this span.
 */
export function startRpcClientSpan(service: string, method: string): RpcSpanHandle {
  const attributes: Attributes = {
    'rpc.system': RPC_SYSTEM,
    'rpc.service': service,
    'rpc.method': method,
  };
  return startSpan(method, SpanKind.CLIENT, context.active(), attributes, () => rpcDurations().client);
}

/** Starts the handling service's span for one inbound TCP message, as a child of the caller's. */
export function startRpcServerSpan(method: string, carrier: TraceCarrier, sourceService?: string): RpcSpanHandle {
  const attributes: Attributes = { 'rpc.system': RPC_SYSTEM, 'rpc.method': method };
  if (sourceService) attributes['rpc.source_service'] = sourceService;
  return startSpan(method, SpanKind.SERVER, extractTraceContext(carrier), attributes, () => rpcDurations().server);
}

function startSpan(
  name: string,
  kind: SpanKind,
  parent: Context,
  attributes: Attributes,
  histogram: () => Histogram,
): RpcSpanHandle {
  const span = trace.getTracer(INSTRUMENTATION_SCOPE).startSpan(name, { kind, attributes }, parent);
  const spanContext = trace.setSpan(parent, span);
  const startedAt = performance.now();
  let ended = false;

  return {
    context: spanContext,
    span,
    end(error?: unknown) {
      if (ended) return;
      ended = true;

      // Metric labels stay low-cardinality on purpose: system/service/method plus a coarse
      // outcome, never ids or messages.
      const metricAttributes: Attributes = { ...attributes };
      if (error !== undefined) {
        const errorType = classifyError(error);
        metricAttributes['error.type'] = errorType;
        span.setAttribute('error.type', errorType);
        span.recordException(error instanceof Error ? error : { message: String(error) });
        // A 4xx-style outcome (not found, forbidden, validation) is the caller's problem, not a
        // fault in this call -- same rule the HTTP semantic conventions apply to server spans.
        if (!isClientError(error)) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(error) });
        }
      }

      histogram().record(performance.now() - startedAt, metricAttributes);
      span.end();
    },
  };
}

/** The HTTP-equivalent status an RPC failure carries, however this repo happened to shape it. */
export function rpcErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    getStatus?: () => unknown;
    getError?: () => unknown;
    status?: unknown;
    statusCode?: unknown;
  };

  if (typeof candidate.getStatus === 'function') {
    const status = candidate.getStatus();
    if (typeof status === 'number') return status;
  }
  if (typeof candidate.getError === 'function') {
    const nested = rpcErrorStatus(candidate.getError());
    if (nested !== undefined) return nested;
  }
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  return undefined;
}

function isClientError(error: unknown): boolean {
  const status = rpcErrorStatus(error);
  return status !== undefined && status >= 400 && status < 500;
}

function classifyError(error: unknown): string {
  const status = rpcErrorStatus(error);
  if (status !== undefined) return String(status);
  return error instanceof Error ? error.name : 'Error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
