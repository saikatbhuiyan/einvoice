import { Request } from 'express';

export type CorrelatedRequest = Request & {
  correlationId?: string;
  traceId?: string;
  _startTime?: bigint;
};

/**
 * Express Request augmented with the high-resolution start time
 * set by request context middleware so downstream interceptors can
 * compute total request duration without re-measuring.
 */
export interface TimedRequest extends CorrelatedRequest {
  _startTime?: bigint;
}
