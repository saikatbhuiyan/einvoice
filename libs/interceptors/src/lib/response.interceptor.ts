import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response } from 'express';
import { ApiEnvelope, TimedRequest } from '@libs/shared/types';
import { ok } from '@libs/shared/utils';

export const SKIP_RESPONSE_WRAP_KEY = 'skipResponseWrap';
export const SkipResponseWrap = () => SetMetadata(SKIP_RESPONSE_WRAP_KEY, true);

export const RESPONSE_MESSAGE_KEY = 'responseMessage';
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE_KEY, message);

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T> | T> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_WRAP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<TimedRequest>();
    const response = http.getResponse<Response>();

    const correlationId = (request.headers['x-correlation-id'] as string) ?? 'unknown';

    // Capture request start time set by LoggerMiddleware (if available)
    const startTime: bigint | undefined = request._startTime;

    const message = this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      map((data) => {
        if (this.isAlreadyWrapped(data)) return data as ApiEnvelope<T>;

        const durationMs = startTime
          ? `${(Number(process.hrtime.bigint() - startTime) / 1_000_000).toFixed(1)}ms`
          : undefined;

        const statusCode = response.statusCode;

        return ok(data, {
          correlationId,
          message: message ?? this.defaultMessage(statusCode),
          statusCode,
          duration: durationMs,
        });
      }),
    );
  }

  private isAlreadyWrapped(data: unknown): data is ApiEnvelope<unknown> {
    return (
      typeof data === 'object' && data !== null && 'success' in data && 'correlationId' in data && 'timestamp' in data
    );
  }

  private defaultMessage(statusCode: number): string {
    const messages: Record<number, string> = {
      200: 'OK',
      201: 'Created',
      202: 'Accepted',
      204: 'No Content',
    };
    return messages[statusCode] ?? 'OK';
  }
}
