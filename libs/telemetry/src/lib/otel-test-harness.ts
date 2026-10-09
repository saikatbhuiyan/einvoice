// Test-only: a real (in-memory) OpenTelemetry setup, so propagation specs exercise the actual
// W3C propagator, async context manager and SDK spans rather than mocks of them. Imported by spec
// files only (`@libs/telemetry/otel-test-harness`) -- never from app code, and not exported from
// the lib's barrel.
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { MeterProvider, MetricReader, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';

class CollectingMetricReader extends MetricReader {
  protected override onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
  protected override onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export interface OtelTestHarness {
  spans(): ReadableSpan[];
  /** Data points of one histogram, as `{ attributes, count }`. */
  histogramPoints(name: string): Promise<Array<{ attributes: Record<string, unknown>; count: number }>>;
  reset(): void;
  shutdown(): Promise<void>;
}

export function installOtelTestHarness(): OtelTestHarness {
  const exporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const reader = new CollectingMetricReader();
  const meterProvider = new MeterProvider({ readers: [reader] });

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(tracerProvider);
  metrics.setGlobalMeterProvider(meterProvider);

  return {
    spans: () => exporter.getFinishedSpans(),
    async histogramPoints(name) {
      const { resourceMetrics } = (await reader.collect()) as { resourceMetrics: ResourceMetrics };
      return resourceMetrics.scopeMetrics
        .flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === name)
        .flatMap((metric) =>
          metric.dataPoints.map((point) => ({
            attributes: point.attributes as Record<string, unknown>,
            count: (point.value as { count: number }).count,
          })),
        );
    },
    reset: () => exporter.reset(),
    async shutdown() {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
      trace.disable();
      metrics.disable();
      propagation.disable();
      context.disable();
    },
  };
}
