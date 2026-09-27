import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import type { IncomingHttpHeaders } from 'http';

const TRACEPARENT_PATTERN = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}(?:-.+)?$/i;
const ID_PATTERN = /^[\w:.-]{1,128}$/;

export interface CorrelationContext {
  correlationId: string;
  traceId: string;
  userId?: string;
  roles?: string[];
  permissions?: string[];
}

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export function resolveCorrelationContext(headers: IncomingHttpHeaders): CorrelationContext {
  const correlationId =
    validHeader(headers['x-correlation-id']) ?? validHeader(headers['x-request-id']) ?? randomUUID();

  const traceId =
    validHeader(headers['x-b3-traceid']) ?? extractTraceIdFromTraceparent(headers['traceparent']) ?? correlationId;

  return { correlationId, traceId };
}

export function firstHeader(value: string | string[] | number | undefined): string | undefined {
  if (typeof value === 'number') return String(value);
  return Array.isArray(value) ? value[0] : value;
}

export function validHeader(value: string | string[] | number | undefined): string | undefined {
  const header = firstHeader(value)?.trim();
  if (!header || !ID_PATTERN.test(header)) return undefined;
  return header;
}

export function extractTraceIdFromTraceparent(value: string | string[] | number | undefined): string | undefined {
  const traceparent = firstHeader(value)?.trim();
  if (!traceparent) return undefined;

  return traceparent.match(TRACEPARENT_PATTERN)?.[1];
}

export function runWithCorrelationContext<T>(context: CorrelationContext, callback: () => T): T {
  return correlationStorage.run(context, callback);
}

export function getCurrentCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

/**
 * Attaches verified identity to the request's already-running correlation context. Must run
 * inside an active `runWithCorrelationContext` call (i.e. after CorrelationIdMiddleware, from a
 * guard or interceptor later in the same request) — mutates the existing store object in place
 * so it's visible to every subsequent `getCurrentCorrelationContext()` read in this request,
 * including the one `createRpcEnvelope` makes when calling a downstream service.
 *
 * Safe to call more than once per request with different fields (e.g. `JwtAuthGuard` sets
 * `userId`/`roles` first, `PermissionGuard` adds `permissions` once it resolves them) — each call
 * only overwrites the fields it's given, leaving the rest of the context untouched.
 */
export function setIdentityOnCurrentContext(identity: {
  userId?: string;
  roles?: string[];
  permissions?: string[];
}): void {
  const context = correlationStorage.getStore();
  if (!context) return;
  if (identity.userId !== undefined) context.userId = identity.userId;
  if (identity.roles !== undefined) context.roles = identity.roles;
  if (identity.permissions !== undefined) context.permissions = identity.permissions;
}
