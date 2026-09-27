import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { UserService } from './user.service';
import { IUserRepository } from './user.repository.interface';
import { RoleService } from '../role/role.service';
import type { KeycloakAdminService } from '@libs/auth/keycloak-admin.service';
import { UserEntity } from '../../../database/entities/user.entity';
import { RoleEntity } from '../../../database/entities/role.entity';

const buildRole = (overrides: Partial<RoleEntity> = {}): RoleEntity =>
  ({
    id: 'role-1',
    name: 'accountant',
    description: 'desc',
    permissions: ['invoice:read'],
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }) as RoleEntity;

const buildUser = (overrides: Partial<UserEntity> = {}): UserEntity =>
  ({
    id: 'user-1',
    email: 'jane@acme.test',
    name: 'Jane Doe',
    roleId: 'role-1',
    role: buildRole(),
    keycloakUserId: 'kc-user-1',
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }) as UserEntity;

type MockedKeycloakAdminService = jest.Mocked<
  Pick<KeycloakAdminService, 'createUser' | 'assignRealmRole' | 'removeRealmRole' | 'setEnabled' | 'deleteUser'>
>;

describe('UserService', () => {
  let repository: jest.Mocked<IUserRepository>;
  let roleService: jest.Mocked<Pick<RoleService, 'getByIdOrThrow'>>;
  let keycloakAdminService: MockedKeycloakAdminService;
  let service: UserService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    };
    roleService = { getByIdOrThrow: jest.fn().mockResolvedValue(buildRole()) };
    keycloakAdminService = {
      createUser: jest.fn().mockResolvedValue('kc-user-1'),
      assignRealmRole: jest.fn().mockResolvedValue(undefined),
      removeRealmRole: jest.fn().mockResolvedValue(undefined),
      setEnabled: jest.fn().mockResolvedValue(undefined),
      deleteUser: jest.fn().mockResolvedValue(undefined),
    };
    service = new UserService(repository, roleService as never, keycloakAdminService as never);
  });

  describe('create', () => {
    it('validates the role exists before provisioning anything', async () => {
      repository.create.mockResolvedValue(buildUser());

      await service.create({ email: 'jane@acme.test', name: 'Jane Doe', roleId: 'role-1' });

      expect(roleService.getByIdOrThrow).toHaveBeenCalledWith('role-1');
    });

    it('creates the Keycloak identity, assigns the realm role, then the local user with the returned keycloakUserId', async () => {
      repository.create.mockResolvedValue(buildUser());

      await service.create({ email: 'jane@acme.test', name: 'Jane Doe', roleId: 'role-1' });

      expect(keycloakAdminService.createUser).toHaveBeenCalledWith({
        username: 'jane@acme.test',
        email: 'jane@acme.test',
        firstName: 'Jane',
        lastName: 'Doe',
      });
      expect(keycloakAdminService.assignRealmRole).toHaveBeenCalledWith('kc-user-1', 'accountant');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'jane@acme.test', keycloakUserId: 'kc-user-1' }),
      );
    });

    it('rolls back the Keycloak user if role assignment fails', async () => {
      const roleError = new Error('role assignment failed');
      keycloakAdminService.assignRealmRole.mockRejectedValue(roleError);

      await expect(service.create({ email: 'jane@acme.test', name: 'Jane', roleId: 'role-1' })).rejects.toBe(roleError);

      expect(keycloakAdminService.deleteUser).toHaveBeenCalledWith('kc-user-1');
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rolls back the Keycloak user if the local write fails', async () => {
      const error = new QueryFailedError('insert', [], new Error('duplicate key'));
      (error as unknown as { driverError: { code: string } }).driverError = { code: '23505' };
      repository.create.mockRejectedValue(error);

      await expect(service.create({ email: 'jane@acme.test', name: 'Jane', roleId: 'role-1' })).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(keycloakAdminService.deleteUser).toHaveBeenCalledWith('kc-user-1');
    });

    it('propagates a role-not-found error without provisioning anything', async () => {
      const notFound = new NotFoundException('Role not found');
      roleService.getByIdOrThrow.mockRejectedValue(notFound);

      await expect(service.create({ email: 'jane@acme.test', name: 'Jane', roleId: 'missing' })).rejects.toBe(notFound);

      expect(keycloakAdminService.createUser).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('maps entities to responses with pagination meta', async () => {
      repository.findAll.mockResolvedValue({ items: [buildUser()], total: 1 });

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].role.name).toBe('accountant');
      expect(result.meta).toMatchObject({ page: 1, limit: 20, total: 1 });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the mapped response when found', async () => {
      repository.findById.mockResolvedValue(buildUser());

      const result = await service.findOne('user-1');

      expect(result.id).toBe('user-1');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('swaps the Keycloak realm role when roleId actually changes', async () => {
      repository.findById.mockResolvedValue(buildUser({ roleId: 'role-1', role: buildRole({ name: 'accountant' }) }));
      roleService.getByIdOrThrow.mockResolvedValue(buildRole({ id: 'role-2', name: 'manager' }));
      repository.update.mockResolvedValue(buildUser({ roleId: 'role-2' }));

      await service.update('user-1', { roleId: 'role-2' });

      expect(roleService.getByIdOrThrow).toHaveBeenCalledWith('role-2');
      expect(keycloakAdminService.removeRealmRole).toHaveBeenCalledWith('kc-user-1', 'accountant');
      expect(keycloakAdminService.assignRealmRole).toHaveBeenCalledWith('kc-user-1', 'manager');
    });

    it('does not touch Keycloak roles when roleId is provided but unchanged', async () => {
      repository.findById.mockResolvedValue(buildUser({ roleId: 'role-1' }));
      repository.update.mockResolvedValue(buildUser({ roleId: 'role-1' }));

      await service.update('user-1', { roleId: 'role-1' });

      expect(roleService.getByIdOrThrow).not.toHaveBeenCalled();
      expect(keycloakAdminService.removeRealmRole).not.toHaveBeenCalled();
      expect(keycloakAdminService.assignRealmRole).not.toHaveBeenCalled();
    });

    it('does not validate or touch a role when roleId is omitted', async () => {
      repository.findById.mockResolvedValue(buildUser());
      repository.update.mockResolvedValue(buildUser({ name: 'New Name' }));

      await service.update('user-1', { name: 'New Name' });

      expect(roleService.getByIdOrThrow).not.toHaveBeenCalled();
      expect(keycloakAdminService.assignRealmRole).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('returns a deactivated confirmation and disables the Keycloak account', async () => {
      repository.deactivate.mockResolvedValue(buildUser({ isActive: false }));

      const result = await service.deactivate('user-1');

      expect(result).toEqual({ id: 'user-1', deactivated: true });
      expect(keycloakAdminService.setEnabled).toHaveBeenCalledWith('kc-user-1', false);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      repository.deactivate.mockResolvedValue(null);

      await expect(service.deactivate('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not fail the operation if disabling the Keycloak account fails', async () => {
      repository.deactivate.mockResolvedValue(buildUser({ isActive: false }));
      keycloakAdminService.setEnabled.mockRejectedValue(new Error('keycloak unreachable'));

      await expect(service.deactivate('user-1')).resolves.toEqual({ id: 'user-1', deactivated: true });
    });
  });
});
