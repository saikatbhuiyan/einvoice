import { Logger } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Cache } from 'cache-manager';
import { of, throwError } from 'rxjs';
import { AuthorizationService } from './authorization.service';
import type { GrpcRole } from './grpc-contracts';

const role = (name: string, permissions: string[]): GrpcRole => ({
  id: `${name}-id`,
  name,
  description: '',
  permissions,
  isActive: true,
});

const ROLES: GrpcRole[] = [
  role('admin', ['invoice:read', 'invoice:write', 'role:read']),
  role('accountant', ['invoice:read', 'invoice:write', 'product:read']),
  role('viewer', ['invoice:read', 'product:read']),
];

describe('AuthorizationService', () => {
  let findAllRoles: jest.Mock;
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: AuthorizationService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    findAllRoles = jest.fn().mockReturnValue(of({ roles: ROLES }));
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn().mockResolvedValue(undefined) };
    const client = { getService: jest.fn().mockReturnValue({ findAllRoles }) } as unknown as ClientGrpc;

    service = new AuthorizationService(client, cache as unknown as Cache);
    service.onModuleInit();
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the permissions of a single role', async () => {
    await expect(service.getPermissionsForRoles(['viewer'])).resolves.toEqual(['invoice:read', 'product:read']);
  });

  it('unions and de-duplicates permissions across several roles', async () => {
    const permissions = await service.getPermissionsForRoles(['viewer', 'accountant']);

    expect(permissions.sort()).toEqual(['invoice:read', 'invoice:write', 'product:read']);
  });

  it('ignores role names user-access does not know (e.g. Keycloak default roles)', async () => {
    await expect(service.getPermissionsForRoles(['default-roles-einvoice', 'offline_access'])).resolves.toEqual([]);
  });

  it('returns no permissions for a caller with no roles', async () => {
    await expect(service.getPermissionsForRoles([])).resolves.toEqual([]);
  });

  describe('caching the roles table', () => {
    it('fetches from user-access on a miss and caches the table for 60s', async () => {
      await service.getPermissionsForRoles(['viewer']);

      expect(findAllRoles).toHaveBeenCalledWith({});
      expect(cache.set).toHaveBeenCalledWith('authorizer:roles', ROLES, 60_000);
    });

    it('serves a hit from cache without calling user-access', async () => {
      cache.get.mockResolvedValue([role('viewer', ['product:read'])]);

      await expect(service.getPermissionsForRoles(['viewer'])).resolves.toEqual(['product:read']);
      expect(findAllRoles).not.toHaveBeenCalled();
    });

    it('still answers when Redis reads and writes both fail', async () => {
      cache.get.mockRejectedValue(new Error('redis down'));
      cache.set.mockRejectedValue(new Error('redis down'));

      await expect(service.getPermissionsForRoles(['viewer'])).resolves.toEqual(['invoice:read', 'product:read']);
    });

    it('treats a response with no roles field (proto3 omits empty repeated fields) as an empty table', async () => {
      findAllRoles.mockReturnValue(of({}));

      await expect(service.getPermissionsForRoles(['admin'])).resolves.toEqual([]);
    });
  });

  it('propagates a user-access failure and caches nothing', async () => {
    findAllRoles.mockReturnValue(throwError(() => new Error('14 UNAVAILABLE')));

    await expect(service.getPermissionsForRoles(['admin'])).rejects.toThrow('14 UNAVAILABLE');
    expect(cache.set).not.toHaveBeenCalled();
  });
});
