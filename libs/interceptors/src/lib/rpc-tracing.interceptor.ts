import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { context as otelContext } from '@opentelemetry/api';
import { Observable, throwError } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { getRpcMeta } from '@libs/transports';
import { startRpcServerSpan } from '@libs/telemetry/rpc-tracing';

type PatternContext = { getPattern(): string };

function hasPattern(ctx: unknown): ctx is PatternContext {
  return typeof ctx === 'object' && ctx !== null && typeof (ctx as PatternContext).getPattern === 'function';
}

/**
 * Continues the caller's trace across Nest's TCP transport: reads the W3C `traceparent` that
 * BaseTcpClient put in the RpcEnvelope's meta, starts this service's SERVER span as its child, and
 * runs the handler inside it -- so everything the handler does (DB queries, Redis, its own outgoing
 * RPC calls, every log line) joins the same trace.
 *
 * Register it before RpcLoggingInterceptor (`useGlobalInterceptors(new RpcTracingInterceptor(),
 * ..., new RpcLoggingInterceptor(), ...)`): the first-registered interceptor is the outermost, so
 * the RPC request/response log lines are written inside the span and carry its trace_id.
 *
 * Only acts on messages that carry a `traceparent`. gRPC calls have no envelope and are already
 * traced by the gRPC auto-instrumentation (via gRPC metadata), so they pass straight through
 * rather than getting a second, duplicate span.
 */
@Injectable()
export class RpcTracingInterceptor implements NestInterceptor {
  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (executionContext.getType() !== 'rpc') {
      return next.handle();
    }

    const rpc = executionContext.switchToRpc();
    const meta = getRpcMeta(rpc.getData());
    if (!meta?.traceparent) {
      return next.handle();
    }

    const pattern = this.resolvePattern(executionContext, rpc.getContext());
    const rpcSpan = startRpcServerSpan(pattern, meta, meta.sourceService);
    let failure: unknown;

    // Subscribing -- not just calling next.handle() -- has to happen inside the span's context:
    // the handler runs lazily on subscription, and that's where its async work captures the
    // active context.
    return new Observable((subscriber) =>
      otelContext.with(rpcSpan.context, () =>
        next
          .handle()
          .pipe(
            catchError((error: unknown) => {
              failure = error;
              return throwError(() => error);
            }),
            finalize(() => rpcSpan.end(failure)),
          )
          .subscribe(subscriber),
      ),
    );
  }

  private resolvePattern(executionContext: ExecutionContext, rpcContext: unknown): string {
    if (hasPattern(rpcContext)) {
      const pattern = rpcContext.getPattern();
      if (typeof pattern === 'string' && pattern) return pattern;
    }
    return `${executionContext.getClass().name}.${executionContext.getHandler().name}`;
  }
}
