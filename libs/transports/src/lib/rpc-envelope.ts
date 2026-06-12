import { getCurrentCorrelationContext, type CorrelationContext } from '@libs/logging';

export interface RpcMeta extends CorrelationContext {
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
      sourceService,
      timestamp: new Date().toISOString(),
    },
  };
}

export function isRpcEnvelope<T = unknown>(value: unknown): value is RpcEnvelope<T> {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  const meta = candidate['meta'];
  return (
    'data' in candidate &&
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
