import axios from 'axios';
import { DEV_USERS, bearer, tokenFor } from '../helpers/auth';

/**
 * Authentication end to end: real Keycloak, real JWT verification in bff. Requires the dev stack.
 */
describe('Authentication through bff (e2e)', () => {
  it('serves health checks without a token', async () => {
    const live = await axios.get('/../health/live');
    const ready = await axios.get('/../health/ready');

    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
  });

  it('rejects a protected route without a token as problem+json 401', async () => {
    const response = await axios.get('/invoices');

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.data).toMatchObject({ status: 401, title: 'Unauthorized' });
  });

  it('rejects a forged token', async () => {
    const forged = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImZha2UifQ.eyJzdWIiOiJ4In0.c2lnbmF0dXJl';

    expect((await axios.get('/invoices', bearer(forged))).status).toBe(401);
  });

  it('rejects a wrong password without leaking whether the user exists', async () => {
    const response = await axios.post('/auth/login', { username: DEV_USERS.accountant.username, password: 'wrong' });

    expect(response.status).toBe(401);
    expect(JSON.stringify(response.data)).not.toContain('DevPassw0rd');
  });

  it('issues a bearer token that bff accepts', async () => {
    const token = await tokenFor('accountant');

    expect((await axios.get('/invoices', bearer(token))).status).toBe(200);
  });

  // The realm sets revokeRefreshToken + refreshTokenMaxReuse: 0 — a used refresh token must die.
  it('rotates refresh tokens: a refresh token works exactly once', async () => {
    const login = await axios.post('/auth/login', DEV_USERS.admin);
    const firstRefresh = login.data.data.refreshToken as string;

    const rotated = await axios.post('/auth/refresh', { refreshToken: firstRefresh });
    const replayed = await axios.post('/auth/refresh', { refreshToken: firstRefresh });

    expect(rotated.status).toBe(201);
    expect(rotated.data.data.refreshToken).not.toBe(firstRefresh);
    expect(replayed.status).toBe(401);
  });

  it('echoes the caller’s correlation id so a request can be traced across services', async () => {
    const response = await axios.get('/invoices', {
      headers: { ...bearer(await tokenFor('accountant')).headers, 'x-correlation-id': 'e2e-correlation-123' },
    });

    expect(response.headers['x-correlation-id']).toBe('e2e-correlation-123');
  });
});
