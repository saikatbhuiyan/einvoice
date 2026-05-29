import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { randomUUID } from 'crypto';

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
    const correlationId = this.extractCorrelationId(data, rpcCtxObject);
    const startAt = process.hrtime.bigint();

    this.logger.log(
      JSON.stringify({
        event: 'rpc_request',
        pattern,
        correlationId,
        payloadKeys: data && typeof data === 'object' ? Object.keys(data) : [],
      }),
    );

    return next.handle().pipe(
      tap(() => {
        this.logger.log(
          JSON.stringify({
            event: 'rpc_response',
            pattern,
            correlationId,
            durationMs: this.elapsedMs(startAt),
            status: 'success',
          }),
        );
      }),
      catchError((err: unknown) => {
        const isRpcException = err instanceof RpcException;
        const message = isRpcException
          ? JSON.stringify(err.getError())
          : err instanceof Error
            ? err.message
            : String(err);

        this.logger.error(
          JSON.stringify({
            event: 'rpc_error',
            pattern,
            correlationId,
            durationMs: this.elapsedMs(startAt),
            status: 'error',
            error: message,
          }),
          err instanceof Error ? err.stack : undefined,
        );

        return throwError(() => err);
      }),
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

  private elapsedMs(startAt: bigint): number {
    return parseFloat((Number(process.hrtime.bigint() - startAt) / 1_000_000).toFixed(3));
  }
}
