import { HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApiEnvelope, PaginatedEnvelope, PaginationMeta, ProblemDetail } from '@libs/shared/types';
import { buildPaginationMeta } from '@libs/shared/types';

export class ApiResponseBuilder {
  static success<T, M = unknown>(
    data: T,
    options: {
      correlationId?: string;
      message?: string;
      statusCode?: number;
      meta?: M;
      duration?: string;
    } = {},
  ): ApiEnvelope<T, M> {
    return {
      success: true,
      statusCode: options.statusCode ?? HttpStatus.OK,
      message: options.message ?? 'OK',
      correlationId: options.correlationId ?? randomUUID(),
      timestamp: new Date().toISOString(),
      duration: options.duration,
      data,
      meta: options.meta,
    };
  }

  static paginated<T>(
    data: T[],
    opts: { page: number; limit: number; total: number },
    options: { correlationId?: string; duration?: string } = {},
  ): PaginatedEnvelope<T> {
    const meta: PaginationMeta = buildPaginationMeta(opts.page, opts.limit, opts.total);
    return {
      success: true,
      statusCode: HttpStatus.OK,
      message: 'OK',
      correlationId: options.correlationId ?? randomUUID(),
      timestamp: new Date().toISOString(),
      duration: options.duration,
      data,
      meta,
    };
  }

  static problem(partial: Partial<ProblemDetail> & { status: number; title: string }): ProblemDetail {
    return {
      type: partial.type ?? `https://httpstatuses.io/${partial.status}`,
      title: partial.title,
      status: partial.status,
      detail: partial.detail,
      instance: partial.instance,
      errors: partial.errors,
      traceId: partial.traceId ?? randomUUID(),
    };
  }
}

export function ok<T>(
  data: T,
  options: { correlationId?: string; message?: string; statusCode?: number; duration?: string } = {},
): ApiEnvelope<T> {
  return ApiResponseBuilder.success(data, options);
}

export function paginated<T>(
  data: T[],
  opts: { page: number; limit: number; total: number },
  options: { correlationId?: string; duration?: string } = {},
): PaginatedEnvelope<T> {
  return ApiResponseBuilder.paginated(data, opts, options);
}

export function problem(
  title: string,
  detail: string,
  status: number,
  extras: Partial<ProblemDetail> = {},
): ProblemDetail {
  return ApiResponseBuilder.problem({ title, detail, status, ...extras });
}
