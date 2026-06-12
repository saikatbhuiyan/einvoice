import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Options } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'http';
import { resolveCorrelationContext } from './correlation-context';

const IGNORED_AUTO_LOG_PATHS = new Set(['/health', '/healthz', '/readyz', '/livez', '/metrics', '/favicon.ico']);

export interface LoggingModuleOptions {
  serviceName: string;
}

export type PinoHttpOptions = Options<IncomingMessage, ServerResponse> & {
  level: 'debug' | 'info';
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

export function createPinoHttpOptions(options: LoggingModuleOptions): PinoHttpOptions {
  const isProduction = process.env['NODE_ENV'] === 'production';

  return {
    level: isProduction ? 'info' : 'debug',
    base: {
      service: options.serviceName,
    },
    transport: isProduction
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
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
      ignore: (req) => IGNORED_AUTO_LOG_PATHS.has(req.url?.split('?')[0] ?? ''),
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
