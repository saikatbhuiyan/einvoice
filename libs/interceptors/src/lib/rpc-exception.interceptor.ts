// fallback GrpcStatus if @grpc/grpc-js is not installed yet
export enum GrpcStatus {
  OK = 0,
  CANCELLED = 1,
  UNKNOWN = 2,
  INVALID_ARGUMENT = 3,
  DEADLINE_EXCEEDED = 4,
  NOT_FOUND = 5,
  ALREADY_EXISTS = 6,
  PERMISSION_DENIED = 7,
  RESOURCE_EXHAUSTED = 8,
  FAILED_PRECONDITION = 9,
  ABORTED = 10,
  OUT_OF_RANGE = 11,
  UNIMPLEMENTED = 12,
  INTERNAL = 13,
  UNAVAILABLE = 14,
  DATA_LOSS = 15,
  UNAUTHENTICATED = 16,
}

import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
export class RpcExceptionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') return next.handle();

    return next.handle().pipe(
      catchError((err: unknown) => {
        if (err instanceof RpcException) return throwError(() => err);

        if (err instanceof HttpException) {
          return throwError(
            () =>
              new RpcException({
                code: this.httpToGrpcCode(err.getStatus()),
                message: err.message,
              }),
          );
        }

        if (err instanceof Error) {
          return throwError(
            () =>
              new RpcException({
                code: GrpcStatus.INTERNAL,
                message: err.message,
              }),
          );
        }

        return throwError(
          () =>
            new RpcException({
              code: GrpcStatus.UNKNOWN,
              message: String(err),
            }),
        );
      }),
    );
  }

  private httpToGrpcCode(httpStatus: number): GrpcStatus {
    const map: Record<number, GrpcStatus> = {
      400: GrpcStatus.INVALID_ARGUMENT,
      401: GrpcStatus.UNAUTHENTICATED,
      403: GrpcStatus.PERMISSION_DENIED,
      404: GrpcStatus.NOT_FOUND,
      409: GrpcStatus.ALREADY_EXISTS,
      422: GrpcStatus.INVALID_ARGUMENT,
      429: GrpcStatus.RESOURCE_EXHAUSTED,
      501: GrpcStatus.UNIMPLEMENTED,
      503: GrpcStatus.UNAVAILABLE,
      504: GrpcStatus.DEADLINE_EXCEEDED,
    };
    return map[httpStatus] ?? GrpcStatus.INTERNAL;
  }
}
