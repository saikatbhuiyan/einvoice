import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, catchError, throwError, TimeoutError } from 'rxjs';
import { statusTitle } from '@libs/shared/utils';

/** Default RPC call timeout — override per-service or per-call */
const DEFAULT_RPC_TIMEOUT_MS = 10_000;

const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ETIMEDOUT']);

interface RpcErrorLike {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  message?: unknown;
  error?: unknown;
}

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
            return throwError(() => new GatewayTimeoutException(`Downstream RPC timeout for pattern "${pattern}".`));
          }

          this.logger.error(`RPC error: pattern="${pattern}"`, err instanceof Error ? err.stack : String(err));
          return throwError(() => this.toHttpException(err, pattern));
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

  private toHttpException(error: unknown, pattern: string): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    if (this.isConnectionError(error)) {
      return new ServiceUnavailableException('Downstream service is unavailable.');
    }

    const rpcError = this.extractRpcError(error);
    const status = this.resolveHttpStatus(rpcError);
    const message = this.resolveMessage(rpcError, `Downstream RPC call failed for pattern "${pattern}".`);

    if (status) {
      const responseStatus = status === HttpStatus.INTERNAL_SERVER_ERROR ? HttpStatus.BAD_GATEWAY : status;

      return new HttpException(
        {
          statusCode: responseStatus,
          message,
          error: this.resolveErrorTitle(rpcError, responseStatus),
        },
        responseStatus,
      );
    }

    return new BadGatewayException(message);
  }

  private extractRpcError(error: unknown): RpcErrorLike | undefined {
    const unwrapped = this.unwrapRpcError(error);
    return this.isRecord(unwrapped) ? unwrapped : undefined;
  }

  private unwrapRpcError(error: unknown): unknown {
    if (!this.isRecord(error)) {
      return error;
    }

    if (this.isRecord(error.response)) {
      return error.response;
    }

    if (this.isRecord(error.err)) {
      return error.err;
    }

    if (this.isRecord(error.error)) {
      return error.error;
    }

    return error;
  }

  private resolveHttpStatus(error?: RpcErrorLike): number | undefined {
    if (!error) {
      return undefined;
    }

    const explicitStatus = this.toHttpStatus(error.status) ?? this.toHttpStatus(error.statusCode);
    if (explicitStatus) {
      return explicitStatus;
    }

    return this.grpcCodeToHttpStatus(error.code);
  }

  private toHttpStatus(value: unknown): number | undefined {
    const status = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isInteger(status) && status >= 400 && status < 600 ? status : undefined;
  }

  private grpcCodeToHttpStatus(value: unknown): number | undefined {
    const code = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

    if (!Number.isInteger(code)) {
      return undefined;
    }

    const statusByGrpcCode: Record<number, number> = {
      1: HttpStatus.BAD_GATEWAY,
      2: HttpStatus.BAD_GATEWAY,
      3: HttpStatus.UNPROCESSABLE_ENTITY,
      4: HttpStatus.GATEWAY_TIMEOUT,
      5: HttpStatus.NOT_FOUND,
      6: HttpStatus.CONFLICT,
      7: HttpStatus.FORBIDDEN,
      8: HttpStatus.TOO_MANY_REQUESTS,
      9: HttpStatus.CONFLICT,
      10: HttpStatus.CONFLICT,
      11: HttpStatus.UNPROCESSABLE_ENTITY,
      12: HttpStatus.NOT_IMPLEMENTED,
      13: HttpStatus.BAD_GATEWAY,
      14: HttpStatus.SERVICE_UNAVAILABLE,
      15: HttpStatus.BAD_GATEWAY,
      16: HttpStatus.UNAUTHORIZED,
    };

    return statusByGrpcCode[code];
  }

  private resolveMessage(error: RpcErrorLike | undefined, fallback: string): string | string[] {
    const message = error?.message;

    if (Array.isArray(message)) {
      return message.map((item) => String(item));
    }

    if (typeof message === 'string' && message.trim()) {
      return message;
    }

    if (message != null) {
      return String(message);
    }

    return fallback;
  }

  private resolveErrorTitle(error: RpcErrorLike | undefined, status: number): string {
    return typeof error?.error === 'string' && error.error.trim() ? error.error : statusTitle(status);
  }

  private isConnectionError(error: unknown): boolean {
    const unwrapped = this.unwrapRpcError(error);
    const record = this.isRecord(unwrapped) ? unwrapped : this.isRecord(error) ? error : undefined;
    const code = record?.code;
    const message = error instanceof Error ? error.message : this.isRecord(error) ? String(error.message ?? '') : '';

    return (
      (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) ||
      [...CONNECTION_ERROR_CODES].some((errorCode) => message.includes(errorCode))
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
