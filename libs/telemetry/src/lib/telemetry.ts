// Deliberately no `@nestjs/*` (or any `@libs/*` that pulls Nest in) anywhere in this file:
// OpenTelemetry instruments libraries by hooking `require()`, so this module has to run before
// express/ioredis/pg/mongodb/@nestjs/core are first required -- importing Nest here would load it
// too early to be instrumented.
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { IncomingMessage } from 'http';

export interface TelemetryOptions {
  serviceName: string;
}

export interface TelemetrySettings {
  tracesEnabled: boolean;
  metricsEnabled: boolean;
  prometheusHost: string;
  prometheusPort: number;
}

const DEFAULT_PROMETHEUS_PORT = 9464;
const SHUTDOWN_TIMEOUT_MS = 3_000;

// Container probes and scrapes, matched with any global prefix in front (`/api/health/live`).
// Without this, every service would emit a trace every few seconds that nobody will ever look at.
const UNTRACED_PATH = /(?:^|\/)(?:health(?:\/[\w-]+)?|healthz|readyz|livez|metrics|favicon\.ico)$/;

let sdk: NodeSDK | undefined;

/**
 * Reads the standard OpenTelemetry environment variables, but decides on them here rather than
 * letting NodeSDK do it: left to itself, NodeSDK treats an *unset* `OTEL_METRICS_EXPORTER` /
 * `OTEL_LOGS_EXPORTER` as "use OTLP" and starts pushing to localhost:4318 even when nothing asked
 * for telemetry. Here everything is off unless explicitly turned on:
 *
 * - traces: `OTEL_EXPORTER_OTLP_ENDPOINT` (or `..._TRACES_ENDPOINT`) is set, and
 *   `OTEL_TRACES_EXPORTER` isn't `none`;
 * - metrics: `OTEL_METRICS_EXPORTER` includes `prometheus` (served on
 *   `OTEL_EXPORTER_PROMETHEUS_HOST`:`OTEL_EXPORTER_PROMETHEUS_PORT`, default 0.0.0.0:9464);
 * - `OTEL_SDK_DISABLED=true` turns both off regardless.
 */
export function resolveTelemetrySettings(env: NodeJS.ProcessEnv = process.env): TelemetrySettings {
  const list = (value: string | undefined) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

  const disabled = env['OTEL_SDK_DISABLED']?.trim().toLowerCase() === 'true';
  const otlpEndpoint = env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] || env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  const port = Number(env['OTEL_EXPORTER_PROMETHEUS_PORT']);

  return {
    tracesEnabled: !disabled && !!otlpEndpoint && !list(env['OTEL_TRACES_EXPORTER']).includes('none'),
    metricsEnabled: !disabled && list(env['OTEL_METRICS_EXPORTER']).includes('prometheus'),
    prometheusHost: env['OTEL_EXPORTER_PROMETHEUS_HOST'] || '0.0.0.0',
    prometheusPort: Number.isInteger(port) && port > 0 ? port : DEFAULT_PROMETHEUS_PORT,
  };
}

export function isUntracedPath(url: string | undefined): boolean {
  return UNTRACED_PATH.test(url?.split('?')[0] ?? '');
}

/**
 * Starts the process-wide OpenTelemetry SDK. Call it from a side-effect module imported as the
 * very first line of `main.ts` (see each app's `src/instrumentation.ts`) -- ES imports are hoisted,
 * so calling it from inside `main.ts`'s body would run after Nest and everything else was loaded.
 * A no-op (zero overhead) when no exporter is configured, so apps run exactly as before without
 * the observability compose overlay.
 */
export function startTelemetry(options: TelemetryOptions, env: NodeJS.ProcessEnv = process.env): boolean {
  if (sdk) return true;

  const settings = resolveTelemetrySettings(env);
  if (!settings.tracesEnabled && !settings.metricsEnabled) return false;

  // The HTTP instrumentation reads this at construction time. 'http' selects the stable semantic
  // conventions (`http.server.request.duration` in seconds, `http.route`, ...), which is what the
  // Grafana dashboards query -- default it here so those names can't silently change.
  env['OTEL_SEMCONV_STABILITY_OPT_IN'] ??= 'http';

  sdk = new NodeSDK({
    serviceName: options.serviceName,
    resource: resourceFromAttributes({
      'service.namespace': 'einvoice',
      'deployment.environment.name': env['NODE_ENV'] ?? 'development',
    }),
    // Explicit, possibly empty, lists -- see resolveTelemetrySettings for why NodeSDK's own
    // env-based defaults aren't used.
    spanProcessors: settings.tracesEnabled ? [new BatchSpanProcessor(new OTLPTraceExporter())] : [],
    metricReaders: settings.metricsEnabled
      ? [new PrometheusExporter({ host: settings.prometheusHost, port: settings.prometheusPort })]
      : [],
    // Logs already reach Loki as JSON on stdout (via Alloy), so the OTel logs pipeline stays off.
    logRecordProcessors: [],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Pure noise for this system: a span per file read, DNS lookup, and raw socket operation.
        // `net` in particular would add a span for every socket write under Nest's TCP transport,
        // which gets one proper span per RPC call from @libs/telemetry/rpc-tracing instead.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request: IncomingMessage) => isUntracedPath(request.url),
        },
        // One span per Express middleware (helmet, cors, body parsers, ...) on every request
        // drowns the spans that matter; routers and route handlers are still traced.
        '@opentelemetry/instrumentation-express': { ignoreLayersType: ['middleware' as never] },
        // Express 5 (Nest 11) routes through the standalone `router` package, which this
        // instrumentation patches separately -- with no way to skip middleware, and duplicating
        // the express instrumentation's route-handler spans. The express one alone already sets
        // `http.route` and names the HTTP span after the route.
        '@opentelemetry/instrumentation-router': { enabled: false },
        // Keep pino's trace_id/span_id injection into every log line written inside a span (that's
        // what links Loki lines to Tempo traces), but don't also ship logs through OTel.
        '@opentelemetry/instrumentation-pino': { disableLogSending: true },
      }),
    ],
  });

  sdk.start();
  return true;
}

/**
 * Flushes buffered spans and stops the Prometheus endpoint. Call it during graceful shutdown,
 * after the app has stopped taking work and before `process.exit`, or the last few seconds of
 * spans (BatchSpanProcessor exports on an interval) are lost. Bounded, so an unreachable
 * collector can't hold up shutdown.
 */
export async function shutdownTelemetry(): Promise<void> {
  const current = sdk;
  if (!current) return;
  sdk = undefined;

  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    current.shutdown().catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
      timer.unref();
    }),
  ]);
  clearTimeout(timer);
}
