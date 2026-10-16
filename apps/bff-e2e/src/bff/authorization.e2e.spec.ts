import axios from 'axios';
import { bearer, tokenFor } from '../helpers/auth';

/**
 * Authorization end to end: bff → Authorizer (gRPC) → user-access (gRPC) resolves permissions,
 * then bff's PermissionGuard and the downstream RpcPermissionGuard enforce them. Seeded roles:
 * accountant = invoice:read, invoice:write, product:read; admin adds user:*, role:read.
 */
describe('Permission enforcement across the gRPC chain (e2e)', () => {
  let accountant: string;
  let admin: string;

  beforeAll(async () => {
    accountant = await tokenFor('accountant');
    admin = await tokenFor('admin');
  });

  it.each([
    ['GET', '/invoices'],
    ['GET', '/products'],
  ])('allows the accountant: %s %s', async (method, url) => {
    const response = await axios.request({ method, url, ...bearer(accountant) });

    expect(response.status).toBe(200);
  });

  it.each([
    ['POST', '/products', 'product:write'],
    ['GET', '/users', 'user:read'],
    ['GET', '/roles', 'role:read'],
  ])('denies the accountant %s %s with 403 naming %s', async (method, url, permission) => {
    const response = await axios.request({ method, url, data: {}, ...bearer(accountant) });

    expect(response.status).toBe(403);
    expect(response.data.detail).toBe(`Missing required permission(s): ${permission}.`);
  });

  it('allows the admin into the user and role APIs the accountant was denied', async () => {
    expect((await axios.get('/users', bearer(admin))).status).toBe(200);

    const roles = await axios.get('/roles', bearer(admin));
    expect(roles.status).toBe(200);
    expect(roles.data.data.items.map((role: { name: string }) => role.name)).toEqual(
      expect.arrayContaining(['admin', 'accountant', 'manager', 'viewer']),
    );
  });

  // Checks the permission check happens *before* validation: a forbidden caller learns nothing
  // about the payload shape (400 vs 403) of an endpoint they can't use.
  it('denies before validating the body', async () => {
    const response = await axios.post('/products', { not: 'a product' }, bearer(accountant));

    expect(response.status).toBe(403);
  });
});
