import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Request } from 'express';
import { ProblemDetail } from '@libs/shared/types';
import { problem as problemFactory } from '@libs/shared/utils';

interface ValidationExceptionBody {
  message: string | string[];
  error?: string;
  statusCode?: number;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();

    const correlationId = (request.headers['x-correlation-id'] as string) ?? 'unknown';

    const problemDetail = this.toProblemDetail(exception, request, correlationId);

    if (problemDetail.status >= 500) {
      this.logger.error(
        JSON.stringify({
          event: 'unhandled_exception',
          correlationId,
          status: problemDetail.status,
          title: problemDetail.title,
          detail: problemDetail.detail,
          path: request.url,
          method: request.method,
        }),
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (problemDetail.status >= 400) {
      this.logger.warn(
        JSON.stringify({
          event: 'http_exception',
          correlationId,
          status: problemDetail.status,
          title: problemDetail.title,
          path: request.url,
          method: request.method,
        }),
      );
    }

    httpAdapter.setHeader(ctx.getResponse(), 'Content-Type', 'application/problem+json');

    httpAdapter.reply(ctx.getResponse(), problemDetail, problemDetail.status);
  }

  private toProblemDetail(exception: unknown, request: Request, correlationId: string): ProblemDetail {
    const instance = request.url;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as ValidationExceptionBody | string;

      if (status === HttpStatus.UNPROCESSABLE_ENTITY || status === HttpStatus.BAD_REQUEST) {
        if (typeof body === 'object' && Array.isArray(body.message)) {
          return problemFactory(this.statusTitle(status), 'One or more fields failed validation.', status, {
            instance,
            errors: this.normaliseValidationMessages(body.message),
            traceId: correlationId,
          });
        }
      }

      return problemFactory(
        this.statusTitle(status),
        typeof body === 'string' ? body : ((body.message as string) ?? exception.message),
        status,
        {
          instance,
          traceId: correlationId,
        },
      );
    }

    const isProd = process.env['NODE_ENV'] === 'production';

    return problemFactory(
      'Internal Server Error',
      isProd
        ? 'An unexpected error occurred. Please try again later.'
        : exception instanceof Error
          ? exception.message
          : String(exception),
      HttpStatus.INTERNAL_SERVER_ERROR,
      {
        instance,
        traceId: correlationId,
      },
    );
  }

  private normaliseValidationMessages(messages: string[]): Record<string, string[]> {
    const errors: Record<string, string[]> = {};
    for (const msg of messages) {
      const spaceIndex = msg.indexOf(' ');
      if (spaceIndex === -1) {
        (errors['general'] ??= []).push(msg);
        continue;
      }
      const field = `/body/${msg.slice(0, spaceIndex)}`;
      const message = msg.slice(spaceIndex + 1);
      (errors[field] ??= []).push(message);
    }
    return errors;
  }

  private statusTitle(status: number): string {
    const titles: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      409: 'Conflict',
      410: 'Gone',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    };
    return titles[status] ?? `HTTP Error ${status}`;
  }
}
