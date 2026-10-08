const MB = 1024 * 1024;

function megabytesFromEnv(name: string, fallbackMb: number): number {
  const parsed = Number(process.env[name]);
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMb) * MB;
}

/**
 * Liveness thresholds. Crossing one marks the process unhealthy, which (via the compose
 * healthcheck + autoheal in dev, or an orchestrator's liveness probe in prod) gets it restarted --
 * so these are "this process is leaking and won't recover on its own" limits, not soft warnings.
 */
export const HEALTH_HEAP_LIMIT_BYTES = megabytesFromEnv('HEALTH_HEAP_LIMIT_MB', 768);
export const HEALTH_RSS_LIMIT_BYTES = megabytesFromEnv('HEALTH_RSS_LIMIT_MB', 1536);

/** Upper bound for any single dependency check, so one hung dependency can't hang the endpoint. */
export const HEALTH_CHECK_TIMEOUT_MS = 1500;
