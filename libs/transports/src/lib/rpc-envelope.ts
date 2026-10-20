import { getCurrentCorrelationContext, type CorrelationContext } from '@libs/logging';
import { injectTraceContext, type TraceCarrier } from '@libs/telemetry/rpc-tracing';

/**
 * `traceparent`/`tracestate` (from TraceCarrier) are the W3C trace context of the caller's span:
 * Nest's TCP transport has no headers, so the envelope is the only place it can travel. Absent
 * when the caller runs without tracing.
 */
export interface RpcMeta extends CorrelationContext, TraceCarrier {
  sourceService: string;
  timestamp: string;
}

export interface RpcEnvelope<T> {
  data: T;
  meta: RpcMeta;
}

export function createRpcEnvelope<T>(data: T, sourceService: string): RpcEnvelope<T> {
  const context = getCurrentCorrelationContext();
  const correlationId = context?.correlationId ?? 'unknown';
  const traceId = context?.traceId ?? correlationId;

  return {
    data,
    meta: {
      correlationId,
      traceId,
      userId: context?.userId,
      roles: context?.roles,
      permissions: context?.permissions,
      organizationId: context?.organizationId,
      systemActor: context?.systemActor,
      sourceService,
      timestamp: new Date().toISOString(),
      ...injectTraceContext(),
    },
  };
}

export function isRpcEnvelope<T = unknown>(value: unknown): value is RpcEnvelope<T> {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  const meta = candidate['meta'];
  // Deliberately not requiring `'data' in candidate` — JSON.stringify drops object keys whose
  // value is `undefined` (e.g. an envelope built from `createRpcEnvelope(undefined, ...)`, which
  // every call with no payload, like ROLE.FIND_ALL, sends), so a legitimate envelope with no data
  // arrives over the wire without a `data` key at all. The `meta` shape alone is enough proof.
  return (
    !!meta &&
    typeof meta === 'object' &&
    typeof (meta as Record<string, unknown>)['correlationId'] === 'string' &&
    typeof (meta as Record<string, unknown>)['traceId'] === 'string'
  );
}

export function unwrapRpcPayload<T>(value: RpcEnvelope<T> | T): T {
  return isRpcEnvelope<T>(value) ? value.data : value;
}

export function getRpcMeta(value: unknown): RpcMeta | undefined {
  return isRpcEnvelope(value) ? value.meta : undefined;
}
