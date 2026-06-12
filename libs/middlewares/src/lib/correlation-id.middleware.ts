import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { randomUUID } from 'crypto';
import { CorrelatedRequest } from '@libs/shared/types';

const TRACEPARENT_PATTERN = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}(?:-.+)?$/i;

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: CorrelatedRequest, res: Response, next: NextFunction): void {
    const correlationId =
      this.firstHeader(req.headers['x-correlation-id']) ??
      this.firstHeader(req.headers['x-request-id']) ??
      randomUUID();

    const traceId =
      this.firstHeader(req.headers['x-b3-traceid']) ??
      this.extractTraceIdFromTraceparent(req.headers['traceparent']) ??
      correlationId;

    req.correlationId = correlationId;
    req.traceId = traceId;
    req.headers['x-correlation-id'] = correlationId;

    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('x-trace-id', traceId);
    next();
  }

  private firstHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private extractTraceIdFromTraceparent(value: string | string[] | undefined): string | undefined {
    const traceparent = this.firstHeader(value);
    if (!traceparent) return undefined;

    return traceparent.match(TRACEPARENT_PATTERN)?.[1];
  }
}
