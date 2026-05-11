import { Request } from 'express';

/**
 * Express Request augmented with the high-resolution start time
 * set by {@link LoggerMiddleware} so downstream interceptors can
 * compute total request duration without re-measuring.
 */
export interface TimedRequest extends Request {
  _startTime: bigint;
}
