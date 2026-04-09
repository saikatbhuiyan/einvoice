import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token']);

const SLOW_REQUEST_THRESHOLD_MS = 3_000;

const SUPPRESSED_PATHS = new Set(['/health', '/healthz', '/readyz', '/metrics', '/favicon.ico']);

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ?? (req.headers['x-request-id'] as string) ?? randomUUID();
    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    const path = req.path ?? req.url;
    if (SUPPRESSED_PATHS.has(path)) {
      return next();
    }

    const startAt = process.hrtime.bigint();
    const { method, url } = req;
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? 'unknown';
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    const contentLength = req.headers['content-length'] ?? '0';

    this.logger.log(
      JSON.stringify({
        event: 'http_request',
        correlationId,
        method,
        url,
        ip,
        userAgent,
        contentLength,
        headers: this.sanitizeHeaders(req.headers),
      }),
    );

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startAt) / 1_000_000;
      const { statusCode } = res;
      const responseSize = res.getHeader('content-length') ?? '-';

      const logEntry = {
        event: 'http_response',
        correlationId,
        method,
        url,
        statusCode,
        durationMs: parseFloat(durationMs.toFixed(3)),
        responseSize,
        ip,
        userAgent,
        slow: durationMs > SLOW_REQUEST_THRESHOLD_MS,
      };

      if (statusCode >= 500) {
        this.logger.error(JSON.stringify(logEntry));
      } else if (statusCode >= 400) {
        this.logger.warn(JSON.stringify(logEntry));
      } else if (durationMs > SLOW_REQUEST_THRESHOLD_MS) {
        this.logger.warn(JSON.stringify({ ...logEntry, alert: 'SLOW_REQUEST' }));
      } else {
        this.logger.log(JSON.stringify(logEntry));
      }
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        const durationMs = Number(process.hrtime.bigint() - startAt) / 1_000_000;
        this.logger.warn(
          JSON.stringify({
            event: 'http_client_disconnected',
            correlationId,
            method,
            url,
            durationMs: parseFloat(durationMs.toFixed(3)),
            ip,
          }),
        );
      }
    });

    next();
  }

  private sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k, SENSITIVE_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v]),
    );
  }
}
