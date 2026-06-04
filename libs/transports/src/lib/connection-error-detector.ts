import { HttpStatus } from '@nestjs/common';

export interface RpcErrorLike {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  message?: unknown;
  error?: unknown;
}

const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ETIMEDOUT']);

export class ConnectionErrorDetector {
  isConnectionError(error: unknown): boolean {
    const unwrapped = this.unwrapRpcError(error);
    const record = this.isRecord(unwrapped) ? unwrapped : this.isRecord(error) ? error : undefined;
    const code = record?.code;
    const message = error instanceof Error ? error.message : this.isRecord(error) ? String(error.message ?? '') : '';

    return (
      (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) ||
      [...CONNECTION_ERROR_CODES].some((errorCode) => message.includes(errorCode))
    );
  }

  unwrapRpcError(error: unknown): unknown {
    if (!this.isRecord(error)) {
      return error;
    }

    if (this.isRecord(error.response)) {
      return error.response;
    }

    if (this.isRecord(error.err)) {
      return error.err;
    }

    if (this.isRecord(error.error)) {
      return error.error;
    }

    return error;
  }

  extractRpcError(error: unknown): RpcErrorLike | undefined {
    const unwrapped = this.unwrapRpcError(error);
    return this.isRecord(unwrapped) ? (unwrapped as RpcErrorLike) : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
