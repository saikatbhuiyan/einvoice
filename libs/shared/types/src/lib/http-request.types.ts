import { Request } from 'express';

export type CorrelatedRequest = Request & {
  correlationId?: string;
  traceId?: string;
};

/**
 * Express Request augmented with the high-resolution start time
 * set by {@link LoggerMiddleware} so downstream interceptors can
 * compute total request duration without re-measuring.
 */
export interface TimedRequest extends CorrelatedRequest {
  _startTime: bigint;
}
