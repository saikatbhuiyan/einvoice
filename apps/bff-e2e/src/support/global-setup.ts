/**
 * E2E runs against the already-running dev stack (`docker compose -f docker-compose.dev.yml up -d`),
 * not a locally served bff: the flows under test cross Keycloak, Authorizer (gRPC), and the TCP
 * services, none of which `nx serve bff` starts. Waits for bff's *readiness* endpoint rather than
 * an open port — Docker publishes the port before the app (or its Redis) is actually ready.
 */
module.exports = async function () {
  const base = process.env['BFF_URL'] ?? 'http://localhost:3300';
  const deadline = Date.now() + 180_000;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health/ready`);
      if (response.ok) {
        await loginOnce(base);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(
    `bff at ${base} never became ready (${lastError}). Start the stack first: docker compose -f docker-compose.dev.yml up -d`,
  );
};

// Logs in once for the whole run. /auth/login allows 5 attempts per IP (refilling one per 10s), so
// per-file logins exhaust it and the suite starts failing on 429s from its own setup.
async function loginOnce(base: string): Promise<void> {
  const users = { ADMIN: 'dev.admin', ACCOUNTANT: 'dev.accountant' } as const;
  for (const [key, username] of Object.entries(users)) {
    const response = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'DevPassw0rd!' }),
    });
    if (!response.ok) throw new Error(`login as ${username} failed: HTTP ${response.status}`);
    const body = (await response.json()) as { data: { accessToken: string } };
    process.env[`E2E_TOKEN_${key}`] = body.data.accessToken;
  }
}
