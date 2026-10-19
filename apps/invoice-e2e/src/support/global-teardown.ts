import { once } from 'events';

// Stops exactly the invoice process global-setup.ts started — never "whatever listens on a port"
// (the scaffold's killPort defaulted to 3000, where the observability overlay publishes Grafana).
module.exports = async function () {
  const app = globalThis.__INVOICE_E2E_APP__;
  if (!app || app.exitCode !== null) return;

  const exited = once(app, 'exit');
  app.kill('SIGTERM');
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (!graceful) {
    app.kill('SIGKILL');
    await exited;
  }
};
