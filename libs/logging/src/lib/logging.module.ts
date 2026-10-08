import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Options } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'http';
import { resolveCorrelationContext } from './correlation-context';

// Matched against the request path with any global prefix / version segment in front of it
// (`/api/health/live`, `/api/v1/healthz`): a container probe every few seconds per service would
// otherwise bury real traffic in "HTTP GET /api/health/live completed with 200" lines.
const IGNORED_AUTO_LOG_PATH = /(?:^|\/)(?:health(?:\/[\w-]+)?|healthz|readyz|livez|metrics|favicon\.ico)$/;

export interface LoggingModuleOptions {
  serviceName: string;
}

// pino-http's `Options` extends `pino.LoggerOptions` via `import pino from 'pino'`, but pino's
// typings are `export = pino`, which that default import can't see without `esModuleInterop` (off
// in this workspace) -- so every pino-level option resolves as missing and has to be declared here.
export type PinoHttpOptions = Options<IncomingMessage, ServerResponse> & {
  level: 'debug' | 'info';
  formatters?: {
    level?: (label: string, number: number) => Record<string, unknown>;
  };
  base: {
    service: string;
  };
  transport?: {
    target: string;
    options: Record<string, unknown>;
  };
  redact: {
    paths: string[];
    censor: string;
  };
};

@Module({})
export class LoggingModule {
  static forRoot(options: LoggingModuleOptions): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRoot({
          assignResponse: true,
          renameContext: 'context',
          pinoHttp: createPinoHttpOptions(options),
        }),
      ],
      exports: [LoggerModule],
    };
  }
}

/**
 * Human-readable output for a developer watching a terminal, or one JSON object per line for a
 * log shipper to parse. `LOG_PRETTY=true|false` decides explicitly (the observability compose
 * overlay sets `false`, since Loki can't parse pino-pretty's colored text); unset, it falls back to
 * pretty everywhere except production -- the behavior before the override existed.
 */
export function shouldPrettyPrint(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env['LOG_PRETTY']?.trim().toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return env['NODE_ENV'] !== 'production';
}

export function isIgnoredAutoLogPath(url: string | undefined): boolean {
  return IGNORED_AUTO_LOG_PATH.test(url?.split('?')[0] ?? '');
}

export function createPinoHttpOptions(options: LoggingModuleOptions): PinoHttpOptions {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const pretty = shouldPrettyPrint();

  return {
    level: isProduction ? 'info' : 'debug',
    base: {
      service: options.serviceName,
    },
    // `"level":"error"` instead of pino's numeric `"level":50`, so the shipper can promote it to a
    // Loki label as-is. Only in JSON mode: pino-pretty does its own level rendering.
    formatters: pretty ? undefined : { level: (label) => ({ level: label }) },
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.set-cookie',
        'req.headers.x-api-key',
        'req.headers.x-auth-token',
        'req.headers.x-session-token',
        'req.headers.proxy-authorization',
      ],
      censor: '[REDACTED]',
    },
    autoLogging: {
      ignore: (req) => isIgnoredAutoLogPath(req.url),
    },
    genReqId: (req, res) => {
      const context = resolveCorrelationContext(req.headers);
      req.headers['x-correlation-id'] = context.correlationId;
      res.setHeader('x-correlation-id', context.correlationId);
      res.setHeader('x-trace-id', context.traceId);
      return context.correlationId;
    },
    customProps: (req) => {
      const context = resolveCorrelationContext(req.headers);
      return {
        correlationId: context.correlationId,
        traceId: context.traceId,
        service: options.serviceName,
      };
    },
    customReceivedObject: (_req, _res, value) => ({
      ...value,
      event: 'http_request',
    }),
    customSuccessObject: (_req, res, value) => ({
      ...value,
      event: 'http_response',
      statusCode: res.statusCode,
    }),
    customErrorObject: (_req, res, error, value) => ({
      ...value,
      event: 'http_error',
      statusCode: res.statusCode,
      error: error.message,
    }),
    customReceivedMessage: (req) => `HTTP ${req.method} ${req.url} started`,
    customSuccessMessage: (req, res) => `HTTP ${req.method} ${req.url} completed with ${res.statusCode}`,
    customErrorMessage: (req, res) => `HTTP ${req.method} ${req.url} failed with ${res.statusCode}`,
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  };
}
