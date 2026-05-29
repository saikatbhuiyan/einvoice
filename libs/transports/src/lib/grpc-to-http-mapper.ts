import { HttpStatus } from '@nestjs/common';
import type { RpcErrorLike } from './connection-error-detector';

const GRPC_TO_HTTP: Record<number, number> = {
  1: HttpStatus.BAD_GATEWAY,
  2: HttpStatus.BAD_GATEWAY,
  3: HttpStatus.UNPROCESSABLE_ENTITY,
  4: HttpStatus.GATEWAY_TIMEOUT,
  5: HttpStatus.NOT_FOUND,
  6: HttpStatus.CONFLICT,
  7: HttpStatus.FORBIDDEN,
  8: HttpStatus.TOO_MANY_REQUESTS,
  9: HttpStatus.CONFLICT,
  10: HttpStatus.CONFLICT,
  11: HttpStatus.UNPROCESSABLE_ENTITY,
  12: HttpStatus.NOT_IMPLEMENTED,
  13: HttpStatus.BAD_GATEWAY,
  14: HttpStatus.SERVICE_UNAVAILABLE,
  15: HttpStatus.BAD_GATEWAY,
  16: HttpStatus.UNAUTHORIZED,
};

export class GrpcToHttpMapper {
  map(grpcCode: unknown): number | undefined {
    const code = typeof grpcCode === 'number' ? grpcCode : typeof grpcCode === 'string' ? Number(grpcCode) : NaN;
    if (!Number.isInteger(code)) return undefined;
    return GRPC_TO_HTTP[code];
  }

  resolveHttpStatus(error?: RpcErrorLike): number | undefined {
    if (!error) return undefined;

    const explicitStatus = this.toHttpStatus(error.status) ?? this.toHttpStatus(error.statusCode);
    if (explicitStatus) return explicitStatus;

    return this.map(error.code);
  }

  private toHttpStatus(value: unknown): number | undefined {
    const status = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isInteger(status) && status >= 400 && status < 600 ? status : undefined;
  }
}
