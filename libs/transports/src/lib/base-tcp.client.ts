import { Logger, OnModuleInit } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, catchError, throwError, TimeoutError } from 'rxjs';

/** Default RPC call timeout — override per-service or per-call */
const DEFAULT_RPC_TIMEOUT_MS = 10_000;

export abstract class BaseTcpClient implements OnModuleInit {
  protected abstract readonly logger: Logger;
  protected abstract readonly client: ClientProxy;

  /** Called by NestJS — ensures the TCP connection is ready before requests arrive */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log(`TCP client connected`);
    } catch (error) {
      this.logger.error('TCP client failed to connect', (error as Error).stack);
      // Don't throw — retryAttempts in the client config will handle reconnection
    }
  }

  /**
   * Request-response RPC call.
   * @param pattern  Message pattern string from TCP_PATTERNS
   * @param payload  Data to send
   * @param timeoutMs  Optional per-call timeout (default 10s)
   */
  protected async send<TResult, TInput = unknown>(
    pattern: string,
    payload: TInput,
    timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
  ): Promise<TResult> {
    return firstValueFrom(
      this.client.send<TResult, TInput>(pattern, payload).pipe(
        timeout(timeoutMs),
        catchError((err) => {
          if (err instanceof TimeoutError) {
            this.logger.error(`RPC timeout: pattern="${pattern}" exceeded ${timeoutMs}ms`);
            return throwError(() => new Error(`RPC_TIMEOUT:${pattern}`));
          }
          this.logger.error(`RPC error: pattern="${pattern}"`, err instanceof Error ? err.stack : String(err));
          return throwError(() => err);
        }),
      ),
    );
  }

  /**
   * Fire-and-forget event emission (no response expected).
   * @param pattern  Message pattern string from TCP_PATTERNS
   * @param payload  Data to emit
   */
  protected emit<TInput = unknown>(pattern: string, payload: TInput): void {
    this.client.emit<void, TInput>(pattern, payload);
  }
}
