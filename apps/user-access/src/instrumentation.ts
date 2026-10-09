// Imported as the very first line of main.ts, before anything else is loaded: OpenTelemetry
// instruments libraries (http, express, ioredis, pg, mongodb, grpc, ...) by hooking `require()`, so
// a module required before this runs is never instrumented. A no-op unless the OTEL_* environment
// enables traces or metrics (see @libs/telemetry's resolveTelemetrySettings).
import { startTelemetry } from '@libs/telemetry';

startTelemetry({ serviceName: 'user-access' });
