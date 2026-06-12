import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, catchError, throwError, TimeoutError } from 'rxjs';
import { statusTitle } from '@libs/shared/utils';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import { ConnectionErrorDetector } from './connection-error-detector';
import { GrpcToHttpMapper } from './grpc-to-http-mapper';
import type { ServiceName } from './tcp.config';
import { createRpcEnvelope, type RpcEnvelope } from './rpc-envelope';

const DEFAULT_RPC_TIMEOUT_MS = 10_000;

export abstract class BaseTcpClient implements OnModuleInit {
  protected abstract readonly logger: Logger;
  protected abstract readonly client: ClientProxy;
  protected abstract readonly serviceName: ServiceName;
  protected readonly sourceService: string = 'unknown';

  private readonly connectionErrorDetector = new ConnectionErrorDetector();
  private readonly grpcToHttpMapper = new GrpcToHttpMapper();

  constructor(
    @Optional() @Inject(CIRCUIT_BREAKER_FACTORY) private readonly circuitBreakerFactory?: CircuitBreakerFactory,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log(`TCP client connected`);
    } catch (error) {
      this.logger.error('TCP client failed to connect', (error as Error).stack);
    }
  }

  protected async send<TResult, TInput = unknown>(
    pattern: string,
    payload: TInput,
    timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
  ): Promise<TResult> {
    const envelope = createRpcEnvelope(payload, this.sourceService);
    const execute = () =>
      firstValueFrom(
        this.client.send<TResult, RpcEnvelope<TInput>>(pattern, envelope).pipe(
          timeout(timeoutMs),
          catchError((err) => {
            if (err instanceof TimeoutError) {
              this.logger.error({
                event: 'rpc_timeout',
                pattern,
                service: this.serviceName,
                sourceService: this.sourceService,
                correlationId: envelope.meta.correlationId,
                traceId: envelope.meta.traceId,
                timeoutMs,
              });
              return throwError(() => new GatewayTimeoutException(`Downstream RPC timeout for pattern "${pattern}".`));
            }

            this.logger.error({
              event: 'rpc_client_error',
              pattern,
              service: this.serviceName,
              sourceService: this.sourceService,
              correlationId: envelope.meta.correlationId,
              traceId: envelope.meta.traceId,
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            });
            return throwError(() => this.toHttpException(err, pattern));
          }),
        ),
      );

    const breaker = this.circuitBreakerFactory?.get(this.serviceName);
    if (!breaker) {
      return execute();
    }

    return breaker.execute(execute);
  }

  protected emit<TInput = unknown>(pattern: string, payload: TInput): void {
    this.client.emit<void, RpcEnvelope<TInput>>(pattern, createRpcEnvelope(payload, this.sourceService));
  }

  private toHttpException(error: unknown, pattern: string): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    if (this.connectionErrorDetector.isConnectionError(error)) {
      return new ServiceUnavailableException('Downstream service is unavailable.');
    }

    const rpcError = this.connectionErrorDetector.extractRpcError(error);
    const status = this.grpcToHttpMapper.resolveHttpStatus(rpcError);
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

  private resolveMessage(
    error: import('./connection-error-detector').RpcErrorLike | undefined,
    fallback: string,
  ): string | string[] {
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

  private resolveErrorTitle(
    error: import('./connection-error-detector').RpcErrorLike | undefined,
    status: number,
  ): string {
    return typeof error?.error === 'string' && error.error.trim() ? error.error : statusTitle(status);
  }
}
