import { createHmac, generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from './authenticated-user.interface';
import type { JwksCacheService } from './jwks-cache.service';
import { JwtStrategy } from './jwt.strategy';

const ISSUER = 'http://keycloak:8080/realms/einvoice';
const signingKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attackerKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = signingKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const nowSeconds = () => Math.floor(Date.now() / 1000);

function rs256(
  payload: object,
  header: object = { alg: 'RS256', typ: 'JWT', kid: 'kid-1' },
  key: KeyObject = signingKeys.privateKey,
) {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${cryptoSign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

const validClaims = (overrides: Record<string, unknown> = {}) => ({
  sub: 'user-1',
  preferred_username: 'dev.accountant',
  email: 'dev@einvoice.test',
  realm_access: { roles: ['accountant', 'default-roles-einvoice'] },
  iss: ISSUER,
  iat: nowSeconds(),
  exp: nowSeconds() + 300,
  ...overrides,
});

type Outcome = { ok: true; user: AuthenticatedUser } | { ok: false; reason: string };

// Drives the real passport-jwt verification path: passport assigns success/fail/error onto a
// strategy instance per request, so a spec can do the same and observe the outcome directly.
function authenticate(strategy: JwtStrategy, authorization?: string): Promise<Outcome> {
  return new Promise((resolve) => {
    const s = strategy as unknown as Record<string, unknown> & { authenticate: (req: object, opts: object) => void };
    s['success'] = (user: AuthenticatedUser) => resolve({ ok: true, user });
    s['fail'] = (info: unknown) => resolve({ ok: false, reason: info instanceof Error ? info.message : String(info) });
    s['error'] = (err: Error) => resolve({ ok: false, reason: err.message });
    s.authenticate({ headers: authorization ? { authorization } : {} }, {});
  });
}

describe('JwtStrategy (real RS256 verification)', () => {
  let jwks: { getSigningKey: jest.Mock };
  let strategy: JwtStrategy;

  beforeEach(() => {
    jwks = { getSigningKey: jest.fn().mockResolvedValue(publicPem) };
    const config = { get: () => ({ issuerUrl: ISSUER }) } as unknown as ConfigService;
    strategy = new JwtStrategy(config, jwks as unknown as JwksCacheService);
  });

  it('accepts a valid token and maps Keycloak claims onto the user', async () => {
    const outcome = await authenticate(strategy, `Bearer ${rs256(validClaims())}`);

    expect(outcome).toEqual({
      ok: true,
      user: {
        sub: 'user-1',
        username: 'dev.accountant',
        email: 'dev@einvoice.test',
        roles: ['accountant', 'default-roles-einvoice'],
      },
    });
    expect(jwks.getSigningKey).toHaveBeenCalledWith('kid-1');
  });

  it('falls back to sub for username and to no roles when those claims are absent', async () => {
    const outcome = await authenticate(
      strategy,
      `Bearer ${rs256(validClaims({ preferred_username: undefined, realm_access: undefined }))}`,
    );

    expect(outcome).toMatchObject({ ok: true, user: { username: 'user-1', roles: [] } });
  });

  it('rejects a request with no bearer token', async () => {
    expect((await authenticate(strategy)).ok).toBe(false);
  });

  it('rejects an expired token', async () => {
    const outcome = await authenticate(strategy, `Bearer ${rs256(validClaims({ exp: nowSeconds() - 10 }))}`);

    expect(outcome).toEqual({ ok: false, reason: 'jwt expired' });
  });

  it('rejects a token from another issuer (e.g. fetched via localhost instead of the internal hostname)', async () => {
    const outcome = await authenticate(
      strategy,
      `Bearer ${rs256(validClaims({ iss: 'http://localhost:8080/realms/einvoice' }))}`,
    );

    expect(outcome).toMatchObject({ ok: false, reason: expect.stringContaining('jwt issuer invalid') });
  });

  it('rejects a token signed by a key other than the one JWKS returned for its kid', async () => {
    const forged = rs256(validClaims(), { alg: 'RS256', typ: 'JWT', kid: 'kid-1' }, attackerKeys.privateKey);

    expect(await authenticate(strategy, `Bearer ${forged}`)).toEqual({ ok: false, reason: 'invalid signature' });
  });

  it('rejects a tampered payload (role escalation after signing)', async () => {
    const [header, , signature] = rs256(validClaims()).split('.');
    const escalated = `${header}.${b64(validClaims({ realm_access: { roles: ['admin'] } }))}.${signature}`;

    expect(await authenticate(strategy, `Bearer ${escalated}`)).toEqual({ ok: false, reason: 'invalid signature' });
  });

  // The classic algorithm-confusion attack: sign HS256 using the server's *public* key as the HMAC
  // secret. Only safe because the strategy pins algorithms to ['RS256'].
  it('rejects an HS256 token signed with the public key as an HMAC secret', async () => {
    const header = b64({ alg: 'HS256', typ: 'JWT', kid: 'kid-1' });
    const payload = b64(validClaims());
    const mac = createHmac('sha256', publicPem).update(`${header}.${payload}`).digest('base64url');

    expect(await authenticate(strategy, `Bearer ${header}.${payload}.${mac}`)).toEqual({
      ok: false,
      reason: 'invalid algorithm',
    });
  });

  it('rejects an unsigned alg:none token', async () => {
    const token = `${b64({ alg: 'none', typ: 'JWT', kid: 'kid-1' })}.${b64(validClaims())}.`;

    expect((await authenticate(strategy, `Bearer ${token}`)).ok).toBe(false);
  });

  it('rejects a token with no kid without ever calling JWKS', async () => {
    const outcome = await authenticate(strategy, `Bearer ${rs256(validClaims(), { alg: 'RS256', typ: 'JWT' })}`);

    expect(outcome).toMatchObject({ ok: false, reason: expect.stringContaining('missing a "kid"') });
    expect(jwks.getSigningKey).not.toHaveBeenCalled();
  });

  it('rejects when the signing key cannot be resolved', async () => {
    jwks.getSigningKey.mockRejectedValue(new Error('JWKS unreachable and no cached key'));

    expect(await authenticate(strategy, `Bearer ${rs256(validClaims())}`)).toEqual({
      ok: false,
      reason: 'JWKS unreachable and no cached key',
    });
  });
});
