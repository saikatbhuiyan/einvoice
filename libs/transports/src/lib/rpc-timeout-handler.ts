import { Logger } from '@nestjs/common';
import { Observable, throwError, timeout, TimeoutError } from 'rxjs';
import { GatewayTimeoutException } from '@nestjs/common';
import { catchError } from 'rxjs/operators';
import { ClientProxy } from '@nestjs/microservices';

export class RpcTimeoutHandler {
  private readonly logger = new Logger(RpcTimeoutHandler.name);

  wrapWithTimeout<TResult, TInput>(
    client: ClientProxy,
    pattern: string,
    payload: TInput,
    timeoutMs: number,
  ): Observable<TResult> {
    return client.send<TResult, TInput>(pattern, payload).pipe(
      timeout(timeoutMs),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          this.logger.error(`RPC timeout: pattern="${pattern}" exceeded ${timeoutMs}ms`);
          return throwError(() => new GatewayTimeoutException(`Downstream RPC timeout for pattern "${pattern}".`));
        }
        return throwError(() => err);
      }),
    );
  }
}
