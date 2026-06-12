import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { TimedRequest } from '@libs/shared/types';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-session-token',
  'proxy-authorization',
]);

const PII_PATH_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[email]' },
  { pattern: /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/g, replacement: '[jwt]' },
];

const SUPPRESSED_PATHS = new Set(['/health', '/healthz', '/readyz', '/livez', '/metrics', '/favicon.ico']);

const SLOW_REQUEST_THRESHOLD_MS = 3_000;
const MAX_BODY_LOG_CHARS = 2_048;

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: TimedRequest, res: Response, next: NextFunction): void {
    const correlationId = req.correlationId ?? (req.headers['x-correlation-id'] as string | undefined) ?? 'unknown';
    const traceId = req.traceId ?? correlationId;

    const path = req.path ?? req.url;

    if (SUPPRESSED_PATHS.has(path)) return next();

    const startAt = process.hrtime.bigint();
    req._startTime = startAt;
    const { method } = req;
    const url = this.sanitizeUrl(req.url);
    const ip = this.extractIp(req);
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    const contentLength = req.headers['content-length'] ?? '0';

    this.logger.log(
      this.serialize({
        event: 'http_request',
        correlationId,
        traceId,
        method,
        url,
        ip,
        userAgent,
        contentLength,
        headers: this.sanitizeHeaders(req.headers),
        ...(this.shouldLogBody(method) && req.body ? { body: this.truncate(JSON.stringify(req.body)) } : {}),
      }),
    );

    res.on('finish', () => {
      const durationMs = this.elapsedMs(startAt);
      const { statusCode } = res;
      const responseSize = res.getHeader('content-length') ?? '-';
      const isSlow = durationMs > SLOW_REQUEST_THRESHOLD_MS;

      const entry = {
        event: 'http_response',
        correlationId,
        traceId,
        method,
        url,
        statusCode,
        durationMs,
        responseSize,
        ip,
        userAgent,
        ...(isSlow ? { alert: 'SLOW_REQUEST' } : {}),
      };

      if (statusCode >= 500) this.logger.error(this.serialize(entry));
      else if (statusCode >= 400 || isSlow) this.logger.warn(this.serialize(entry));
      else this.logger.log(this.serialize(entry));
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        this.logger.warn(
          this.serialize({
            event: 'http_client_disconnected',
            correlationId,
            traceId,
            method,
            url,
            durationMs: this.elapsedMs(startAt),
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

  private sanitizeUrl(url: string): string {
    return PII_PATH_PATTERNS.reduce((acc, { pattern, replacement }) => acc.replace(pattern, replacement), url);
  }

  private extractIp(req: TimedRequest): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      (req.headers['x-real-ip'] as string) ??
      req.socket?.remoteAddress ??
      'unknown'
    );
  }

  private elapsedMs(startAt: bigint): number {
    return parseFloat((Number(process.hrtime.bigint() - startAt) / 1_000_000).toFixed(3));
  }

  private shouldLogBody(method: string): boolean {
    return ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase());
  }

  private truncate(value: string): string {
    if (value.length <= MAX_BODY_LOG_CHARS) return value;
    return value.slice(0, MAX_BODY_LOG_CHARS) + `…[truncated ${value.length - MAX_BODY_LOG_CHARS} chars]`;
  }

  private serialize(obj: Record<string, unknown>): string {
    return JSON.stringify(obj);
  }
}
