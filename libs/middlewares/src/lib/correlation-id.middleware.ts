import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { CorrelatedRequest } from '@libs/shared/types';
import { resolveCorrelationContext, runWithCorrelationContext } from '@libs/logging';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: CorrelatedRequest, res: Response, next: NextFunction): void {
    const { correlationId, traceId } = resolveCorrelationContext(req.headers);

    req.correlationId = correlationId;
    req.traceId = traceId;
    req._startTime = process.hrtime.bigint();
    req.headers['x-correlation-id'] = correlationId;

    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('x-trace-id', traceId);
    runWithCorrelationContext({ correlationId, traceId }, next);
  }
}
