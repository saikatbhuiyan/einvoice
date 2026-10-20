import { Logger } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Cache } from 'cache-manager';
import { of, throwError } from 'rxjs';
import { AuthorizationService } from './authorization.service';
import type { GrpcMembership, GrpcRole } from './grpc-contracts';

const role = (name: string, permissions: string[], scope = 'organization'): GrpcRole => ({
  id: `${name}-id`,
  name,
  description: '',
  permissions,
  isActive: true,
  scope,
});

const ROLES: GrpcRole[] = [
  role('admin', ['invoice:read', 'invoice:write', 'user:write']),
  role('viewer', ['invoice:read']),
  role('platform-admin', ['platform:admin'], 'platform'),
];

const ACME: GrpcMembership = {
  organizationId: 'org-acme',
  organizationName: 'Acme',
  roleName: 'admin',
  permissions: ['invoice:read', 'invoice:write', 'user:write'],
};
const GLOBEX: GrpcMembership = {
  organizationId: 'org-globex',
  organizationName: 'Globex',
  roleName: 'viewer',
  permissions: ['invoice:read'],
};

describe('AuthorizationService.resolveCaller', () => {
  let findAllRoles: jest.Mock;
  let resolveMembership: jest.Mock;
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: AuthorizationService;

  const resolve = (overrides: Partial<{ userId: string; roles: string[]; organizationId: string }> = {}) =>
    service.resolveCaller({ userId: 'kc-1', roles: [], organizationId: '', ...overrides });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    findAllRoles = jest.fn().mockReturnValue(of({ roles: ROLES }));
    resolveMembership = jest.fn().mockReturnValue(of({ memberships: [ACME, GLOBEX] }));
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn().mockResolvedValue(undefined) };
    const client = {
      getService: jest.fn((name: string) => (name === 'RoleQueryService' ? { findAllRoles } : { resolveMembership })),
    } as unknown as ClientGrpc;

    service = new AuthorizationService(client, cache as unknown as Cache);
    service.onModuleInit();
  });

  afterEach(() => jest.restoreAllMocks());

  it("resolves the requested organization to that membership's role and permissions", async () => {
    const result = await resolve({ organizationId: 'org-globex' });

    expect(resolveMembership).toHaveBeenCalledWith({ keycloakUserId: 'kc-1' });
    expect(result).toEqual({
      status: 'resolved',
      organizationId: 'org-globex',
      roleName: 'viewer',
      permissions: ['invoice:read'],
      memberships: [
        { organizationId: 'org-acme', organizationName: 'Acme', roleName: 'admin' },
        { organizationId: 'org-globex', organizationName: 'Globex', roleName: 'viewer' },
      ],
    });
  });

  it('refuses an organization the caller does not belong to, granting no organization permissions', async () => {
    const result = await resolve({ organizationId: 'org-elsewhere' });

    expect(result).toMatchObject({ status: 'not_member', organizationId: '', permissions: [] });
  });

  it('uses the only membership when none is requested', async () => {
    resolveMembership.mockReturnValue(of({ memberships: [ACME] }));

    await expect(resolve()).resolves.toMatchObject({
      status: 'resolved',
      organizationId: 'org-acme',
      roleName: 'admin',
    });
  });

  it('is ambiguous with several memberships and none requested', async () => {
    await expect(resolve()).resolves.toMatchObject({ status: 'ambiguous', organizationId: '', permissions: [] });
  });

  it('is none for someone without memberships (proto3 omits the empty list)', async () => {
    resolveMembership.mockReturnValue(of({}));

    await expect(resolve()).resolves.toMatchObject({ status: 'none', permissions: [], memberships: [] });
  });

  // The model change: realm roles like "admin" no longer grant organization permissions.
  it('ignores organization roles arriving as Keycloak realm roles', async () => {
    resolveMembership.mockReturnValue(of({ memberships: [GLOBEX] }));

    const result = await resolve({ roles: ['admin'] });

    expect(result.permissions).toEqual(['invoice:read']);
  });

  it('adds platform permissions from platform realm roles, with or without an organization', async () => {
    resolveMembership.mockReturnValue(of({ memberships: [GLOBEX] }));
    expect((await resolve({ roles: ['platform-admin'] })).permissions).toEqual(['invoice:read', 'platform:admin']);

    resolveMembership.mockReturnValue(of({ memberships: [] }));
    await expect(resolve({ roles: ['platform-admin'] })).resolves.toMatchObject({
      status: 'none',
      permissions: ['platform:admin'],
    });
  });

  it('skips the roles lookup entirely for a caller with no realm roles', async () => {
    await resolve({ organizationId: 'org-acme' });

    expect(findAllRoles).not.toHaveBeenCalled();
  });

  describe('caching', () => {
    it('caches memberships per user and the roles table, for 60s', async () => {
      await resolve({ roles: ['platform-admin'], organizationId: 'org-acme' });

      expect(cache.set).toHaveBeenCalledWith('authorizer:memberships:kc-1', [ACME, GLOBEX], 60_000);
      expect(cache.set).toHaveBeenCalledWith('authorizer:roles', ROLES, 60_000);
    });

    it('serves memberships from cache without calling user-access', async () => {
      cache.get.mockImplementation(async (key: string) => (key === 'authorizer:memberships:kc-1' ? [ACME] : undefined));

      await expect(resolve()).resolves.toMatchObject({ status: 'resolved', organizationId: 'org-acme' });
      expect(resolveMembership).not.toHaveBeenCalled();
    });

    it('still answers when Redis reads and writes both fail', async () => {
      cache.get.mockRejectedValue(new Error('redis down'));
      cache.set.mockRejectedValue(new Error('redis down'));

      await expect(resolve({ organizationId: 'org-acme' })).resolves.toMatchObject({ status: 'resolved' });
    });
  });

  it('propagates a user-access failure and caches nothing', async () => {
    resolveMembership.mockReturnValue(throwError(() => new Error('14 UNAVAILABLE')));

    await expect(resolve()).rejects.toThrow('14 UNAVAILABLE');
    expect(cache.set).not.toHaveBeenCalledWith('authorizer:memberships:kc-1', expect.anything(), expect.anything());
  });
});
