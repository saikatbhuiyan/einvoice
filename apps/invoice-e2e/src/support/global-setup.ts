import { spawn, type ChildProcess } from 'child_process';
import { openSync, readFileSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Starts the built invoice app (`invoice:build` runs first) as a child process this suite owns,
 * and global-teardown.ts stops exactly that process.
 *
 * Deliberately not `dependsOn: invoice:serve`: when the e2e run ended, Nx's node executor was
 * left orphaned and the invoice app it spawned kept listening on 3302 indefinitely. The next run's
 * readiness check was then answered by that stale process — possibly running old code — while
 * the run's own app couldn't bind the port, and tests intermittently hung.
 *
 * Mongo + Redis must already be up: `docker compose -f docker-compose.dev.yml up -d redis mongodb`.
 */
const WORKSPACE_ROOT = join(__dirname, '../../../..');
export const APP_LOG = join(tmpdir(), 'invoice-e2e-app.log');

declare global {
  var __INVOICE_E2E_APP__: ChildProcess | undefined;
}

function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `Port ${port} is already in use — a stale invoice process? Find it with \`lsof -nP -iTCP:${port} -sTCP:LISTEN\` and stop it; the suite must test the app it starts.`,
            )
          : error,
      ),
    );
    probe.listen(port, () => probe.close(() => resolve()));
  });
}

module.exports = async function () {
  // INVOICE_HTTP_PORT is what the app listens on. Not the generic PORT: Nx injects the
  // workspace-root .env into every task, and that sets PORT=3300 (bff's port).
  const port = Number(process.env['INVOICE_HTTP_PORT'] ?? 3302);
  await assertPortFree(port);

  const log = openSync(APP_LOG, 'w');
  const app = spawn(process.execPath, [join(WORKSPACE_ROOT, 'dist/apps/invoice/main.js')], {
    cwd: WORKSPACE_ROOT,
    // NODE_ENV is set explicitly, not inherited: Jest sets it to "test", and the app would then look
    // for a .env.test that doesn't exist instead of loading .env.dev. MONGODB_DIRECT_CONNECTION too:
    // dev Mongo is a replica set advertising the member host "mongodb", unresolvable from the host.
    env: {
      ...process.env,
      NODE_ENV: 'development',
      INVOICE_HTTP_PORT: String(port),
      MONGODB_DIRECT_CONNECTION: 'true',
    },
    stdio: ['ignore', log, log],
  });
  globalThis.__INVOICE_E2E_APP__ = app;

  let exitCode: number | null = null;
  app.once('exit', (code) => (exitCode = code ?? -1));

  // Polls readiness rather than @nx/node's waitForPortOpen: on current Node a refused connection
  // to "localhost" surfaces as an AggregateError with no `code`, which waitForPortOpen treats as
  // fatal on the first attempt instead of retrying while the app (several seconds waiting on
  // Kafka at startup) boots.
  const url = `http://localhost:${port}/api/health/ready`;
  const deadline = Date.now() + 180_000;
  let lastError = '';

  while (Date.now() < deadline) {
    if (exitCode !== null) {
      throw new Error(`invoice exited with code ${exitCode} before becoming ready. Last log lines:\n${tail(APP_LOG)}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  app.kill('SIGKILL');
  throw new Error(`invoice at ${url} never became ready (${lastError}). Log: ${APP_LOG}`);
};

function tail(path: string, lines = 20): string {
  return readFileSync(path, 'utf8').trim().split('\n').slice(-lines).join('\n');
}
