export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string[]>;
  /** The distributed trace id -- the same value as the x-trace-id response header; look it up in Tempo. */
  traceId?: string;
  /** The request's correlation id -- the same value as the x-correlation-id response header. */
  correlationId?: string;
}

export interface ApiEnvelope<T = unknown, M = unknown> {
  success: boolean;
  statusCode: number;
  message: string;
  correlationId: string;
  timestamp: string;
  duration?: string;
  data?: T;
  meta?: M;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface OffsetPaginationMeta extends PaginationMeta {
  mode: 'offset';
}

export interface CursorPaginationMeta {
  mode: 'cursor';
  limit: number;
  hasNextPage: boolean;
  cursor?: string;
}

export type PaginationResultMeta = OffsetPaginationMeta | CursorPaginationMeta;

export interface PaginatedResult<T = unknown> {
  items: T[];
  meta: PaginationResultMeta;
}

export type PaginatedEnvelope<T> = ApiEnvelope<T[], PaginationMeta>;
