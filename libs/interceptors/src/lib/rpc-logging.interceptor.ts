import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import { getRpcMeta, type RpcMeta } from '@libs/transports';
import { runWithCorrelationContext } from '@libs/logging';

type TopicContext = { getTopic(): string };
type MessageContext = { getMessage(): { headers?: Record<string, unknown> } };
type MetadataContext = { getMetadata(): Map<string, string[]> };
type RpcContext = TopicContext | MessageContext | MetadataContext;

function isTopicContext(ctx: unknown): ctx is TopicContext {
  return typeof ctx === 'object' && ctx !== null && typeof (ctx as TopicContext).getTopic === 'function';
}

function isMessageContext(ctx: unknown): ctx is MessageContext {
  return typeof ctx === 'object' && ctx !== null && typeof (ctx as MessageContext).getMessage === 'function';
}

function isMetadataContext(ctx: unknown): ctx is MetadataContext {
  return typeof ctx === 'object' && ctx !== null && typeof (ctx as MetadataContext).getMetadata === 'function';
}

@Injectable()
export class RpcLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RPC');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') {
      return next.handle();
    }

    const rpcContext = context.switchToRpc();
    const data = rpcContext.getData<Record<string, unknown>>();
    const rpcCtxObject = rpcContext.getContext<Record<string, unknown>>();

    const pattern = this.extractPattern(context, rpcCtxObject);
    const meta = this.extractRpcMeta(data, rpcCtxObject);
    const startAt = process.hrtime.bigint();

    this.logger.log({
      event: 'rpc_request',
      pattern,
      correlationId: meta.correlationId,
      traceId: meta.traceId,
      sourceService: meta.sourceService,
      payloadKeys: data && typeof data === 'object' ? Object.keys(data) : [],
    });

    // Every service that only ever *receives* RPC calls (invoice/product/user-access's TCP
    // controllers) never touched this correlation context before — until now, only bff (over
    // HTTP, via CorrelationIdMiddleware) ever established it, because only bff ever made an
    // outgoing RPC call in the first place. That stopped being true the moment invoice became an
    // RPC *client* itself (calling pdf-generator/media): createRpcEnvelope() reads whatever's on
    // this same AsyncLocalStorage context, so without re-establishing it here, invoice's outgoing
    // calls would silently carry no correlationId/traceId/identity, and pdf-generator/media's own
    // global RpcPermissionGuard would reject them as unauthenticated — the exact same class of bug
    // the gRPC series' RpcPermissionGuard fix caught, just on the TCP side. Running the handler
    // (and anything it awaits or calls out to) inside runWithCorrelationContext is what makes
    // identity propagation "automatic, no per-call-site wiring" actually hold for every hop, not
    // just the first one from bff.
    return runWithCorrelationContext(meta, () =>
      next.handle().pipe(
        tap(() => {
          this.logger.log({
            event: 'rpc_response',
            pattern,
            correlationId: meta.correlationId,
            traceId: meta.traceId,
            sourceService: meta.sourceService,
            durationMs: this.elapsedMs(startAt),
            status: 'success',
          });
        }),
        catchError((err: unknown) => {
          const isRpcException = err instanceof RpcException;
          const message = isRpcException
            ? JSON.stringify(err.getError())
            : err instanceof Error
              ? err.message
              : String(err);

          this.logger.error({
            event: 'rpc_error',
            pattern,
            correlationId: meta.correlationId,
            traceId: meta.traceId,
            sourceService: meta.sourceService,
            durationMs: this.elapsedMs(startAt),
            status: 'error',
            error: message,
            stack: err instanceof Error ? err.stack : undefined,
          });

          return throwError(() => err);
        }),
      ),
    );
  }

  private extractPattern(context: ExecutionContext, rpcCtx: Record<string, unknown>): string {
    if (isTopicContext(rpcCtx)) {
      return rpcCtx.getTopic();
    }

    const handlerName = context.getHandler().name;
    const className = context.getClass().name;
    return `${className}.${handlerName}`;
  }

  private extractRpcMeta(data: Record<string, unknown> | unknown, rpcCtx: Record<string, unknown>): RpcMeta {
    const envelopeMeta = getRpcMeta(data);
    if (envelopeMeta) return envelopeMeta;

    const correlationId = this.extractCorrelationId(data, rpcCtx);
    const traceId = this.extractTraceId(data, rpcCtx) ?? correlationId;

    return {
      correlationId,
      traceId,
      sourceService: 'legacy',
      timestamp: new Date().toISOString(),
    };
  }

  private extractCorrelationId(data: Record<string, unknown> | unknown, rpcCtx: Record<string, unknown>): string {
    if (data && typeof data === 'object' && 'correlationId' in data) {
      return String((data as Record<string, unknown>).correlationId);
    }

    if (isMessageContext(rpcCtx)) {
      const msg = rpcCtx.getMessage();
      const headers = msg?.headers ?? {};
      const id = headers['x-correlation-id']?.toString() ?? headers['correlation-id']?.toString();
      if (id) return id;
    }

    if (isMetadataContext(rpcCtx)) {
      const meta = rpcCtx.getMetadata();
      const id = meta?.get?.('x-correlation-id')?.[0];
      if (id) return id;
    }

    return randomUUID();
  }

  private extractTraceId(data: Record<string, unknown> | unknown, rpcCtx: Record<string, unknown>): string | undefined {
    if (data && typeof data === 'object' && 'traceId' in data) {
      return String((data as Record<string, unknown>).traceId);
    }

    if (isMessageContext(rpcCtx)) {
      const msg = rpcCtx.getMessage();
      const headers = msg?.headers ?? {};
      const id = headers['x-trace-id']?.toString() ?? headers['trace-id']?.toString();
      if (id) return id;
    }

    if (isMetadataContext(rpcCtx)) {
      const meta = rpcCtx.getMetadata();
      const id = meta?.get?.('x-trace-id')?.[0];
      if (id) return id;
    }

    return undefined;
  }

  private elapsedMs(startAt: bigint): number {
    return parseFloat((Number(process.hrtime.bigint() - startAt) / 1_000_000).toFixed(3));
  }
}
