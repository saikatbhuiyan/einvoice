import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import type { IncomingHttpHeaders } from 'http';
import { isSpanContextValid, trace } from '@opentelemetry/api';

const TRACEPARENT_PATTERN = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}(?:-.+)?$/i;
const ID_PATTERN = /^[\w:.-]{1,128}$/;

export interface CorrelationContext {
  correlationId: string;
  traceId: string;
  userId?: string;
  roles?: string[];
  permissions?: string[];
  /**
   * The organization the caller is acting in (resolved by bff from their memberships). Every
   * tenant-owned query is scoped to it; read it with requireOrganizationId().
   */
  organizationId?: string;
  /** The calling service, when this context was established from an incoming RPC (RpcMeta). */
  sourceService?: string;
  /**
   * Set instead of `userId` when the system itself is acting -- a scheduled job, not an end user
   * (e.g. `overdue-job`). Only code inside a service sets it (runAsSystem); nothing derives it from a
   * request. Audit entries attribute such work to `system:<actor>`.
   */
  systemActor?: string;
}

/** A tenant-scoped operation ran without an organization in its context -- always a bug. */
export class MissingOrganizationContextError extends Error {
  constructor() {
    super('No organization in the request context; tenant-owned data cannot be accessed unscoped.');
    this.name = 'MissingOrganizationContextError';
  }
}

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export function resolveCorrelationContext(headers: IncomingHttpHeaders): CorrelationContext {
  const correlationId =
    validHeader(headers['x-correlation-id']) ?? validHeader(headers['x-request-id']) ?? randomUUID();

  // With tracing on, the HTTP instrumentation has already started (or continued, from an inbound
  // `traceparent`) this request's span -- use its id, so the x-trace-id response header, the
  // RpcEnvelope's traceId and every log line all carry the one id you can look up in Tempo.
  const traceId =
    activeOpenTelemetryTraceId() ??
    validHeader(headers['x-b3-traceid']) ??
    extractTraceIdFromTraceparent(headers['traceparent']) ??
    correlationId;

  return { correlationId, traceId };
}

export function activeOpenTelemetryTraceId(): string | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return spanContext && isSpanContextValid(spanContext) ? spanContext.traceId : undefined;
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
  organizationId?: string;
}): void {
  const context = correlationStorage.getStore();
  if (!context) return;
  if (identity.userId !== undefined) context.userId = identity.userId;
  if (identity.roles !== undefined) context.roles = identity.roles;
  if (identity.permissions !== undefined) context.permissions = identity.permissions;
  if (identity.organizationId !== undefined) context.organizationId = identity.organizationId;
}

/**
 * The active organization, for scoping tenant-owned data. Throws instead of returning undefined:
 * an unscoped query on tenant data must be impossible, not merely unlikely.
 */
export function requireOrganizationId(): string {
  const organizationId = correlationStorage.getStore()?.organizationId;
  if (!organizationId) throw new MissingOrganizationContextError();
  return organizationId;
}

/**
 * Runs `work` acting in `organizationId`: a copy of the current context (correlation and trace ids,
 * calling service) with the organization set. For work whose organization comes from stored data
 * rather than the caller -- a Stripe webhook for a payment recorded in some organization, an event
 * about an invoice. The surrounding context is left untouched.
 */
export function runInOrganization<T>(organizationId: string, work: () => T): T {
  const current = correlationStorage.getStore();
  return correlationStorage.run(
    {
      correlationId: current?.correlationId ?? randomUUID(),
      traceId: current?.traceId ?? activeOpenTelemetryTraceId() ?? randomUUID(),
      ...current,
      organizationId,
    },
    work,
  );
}

/**
 * Runs `work` as the system itself, acting in one organization with exactly `permissions` -- for
 * background jobs, which have no end user but still call permission-gated services (RpcPermission-
 * Guard accepts a system actor in place of a user, and checks permissions the same way). Grant the
 * least the job needs. Any user identity of the surrounding context is dropped: the work must never
 * be attributed to, or authorized as, whoever happened to trigger it.
 */
export function runAsSystem<T>(
  principal: { actor: string; organizationId: string; permissions: string[] },
  work: () => T,
): T {
  const current = correlationStorage.getStore();
  return correlationStorage.run(
    {
      correlationId: current?.correlationId ?? randomUUID(),
      traceId: current?.traceId ?? activeOpenTelemetryTraceId() ?? randomUUID(),
      sourceService: current?.sourceService,
      systemActor: principal.actor,
      organizationId: principal.organizationId,
      permissions: principal.permissions,
    },
    work,
  );
}
