import { isUntracedPath, resolveTelemetrySettings, shutdownTelemetry, startTelemetry } from './telemetry';

describe('resolveTelemetrySettings', () => {
  it('turns everything off when nothing is configured', () => {
    expect(resolveTelemetrySettings({})).toEqual({
      tracesEnabled: false,
      metricsEnabled: false,
      prometheusHost: '0.0.0.0',
      prometheusPort: 9464,
    });
  });

  it('enables traces from an OTLP endpoint and metrics from OTEL_METRICS_EXPORTER=prometheus', () => {
    const settings = resolveTelemetrySettings({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://tempo:4318',
      OTEL_METRICS_EXPORTER: 'prometheus',
      OTEL_EXPORTER_PROMETHEUS_PORT: '9500',
    });

    expect(settings).toMatchObject({ tracesEnabled: true, metricsEnabled: true, prometheusPort: 9500 });
  });

  it('accepts a traces-specific endpoint and a list-valued metrics exporter', () => {
    const settings = resolveTelemetrySettings({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://tempo:4318/v1/traces',
      OTEL_METRICS_EXPORTER: 'console, Prometheus',
    });

    expect(settings).toMatchObject({ tracesEnabled: true, metricsEnabled: true });
  });

  it('honors OTEL_TRACES_EXPORTER=none and OTEL_SDK_DISABLED', () => {
    expect(
      resolveTelemetrySettings({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://tempo:4318', OTEL_TRACES_EXPORTER: 'none' })
        .tracesEnabled,
    ).toBe(false);
    expect(
      resolveTelemetrySettings({
        OTEL_SDK_DISABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://tempo:4318',
        OTEL_METRICS_EXPORTER: 'prometheus',
      }),
    ).toMatchObject({ tracesEnabled: false, metricsEnabled: false });
  });

  it('falls back to the default port for an invalid OTEL_EXPORTER_PROMETHEUS_PORT', () => {
    expect(resolveTelemetrySettings({ OTEL_EXPORTER_PROMETHEUS_PORT: 'abc' }).prometheusPort).toBe(9464);
  });
});

describe('startTelemetry', () => {
  it('does not start an SDK (or touch the environment) when nothing is configured', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(startTelemetry({ serviceName: 'test' }, env)).toBe(false);
    expect(env['OTEL_SEMCONV_STABILITY_OPT_IN']).toBeUndefined();
  });
});

describe('isUntracedPath', () => {
  it.each(['/api/health/live', '/api/health/ready?x=1', '/health', '/metrics'])('skips %s', (path) => {
    expect(isUntracedPath(path)).toBe(true);
  });

  it.each(['/api/v1/invoices', '/api/v1/invoices/123/pdf', undefined])('traces %s', (path) => {
    expect(isUntracedPath(path)).toBe(false);
  });
});

describe('startTelemetry / shutdownTelemetry with the real SDK', () => {
  // A fixed high port rather than 0: the Prometheus exporter needs a concrete port to report.
  const port = 19464;

  afterEach(() => shutdownTelemetry());

  it('serves a Prometheus endpoint while running and releases it on shutdown', async () => {
    const env: NodeJS.ProcessEnv = {
      OTEL_METRICS_EXPORTER: 'prometheus',
      OTEL_EXPORTER_PROMETHEUS_HOST: '127.0.0.1',
      OTEL_EXPORTER_PROMETHEUS_PORT: String(port),
    };

    expect(startTelemetry({ serviceName: 'spec-service' }, env)).toBe(true);
    expect(env['OTEL_SEMCONV_STABILITY_OPT_IN']).toBe('http');

    const scrape = await waitFor(() => fetch(`http://127.0.0.1:${port}/metrics`));
    expect(scrape.status).toBe(200);
    expect(await scrape.text()).toContain('service_name="spec-service"');

    await shutdownTelemetry();
    await expect(fetch(`http://127.0.0.1:${port}/metrics`)).rejects.toThrow();
  });

  it('resolves when shutdown is called with no SDK running', async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});

async function waitFor<T>(attempt: () => Promise<T>, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
