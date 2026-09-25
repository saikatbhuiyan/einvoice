import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { UserService } from './user.service';
import { IUserRepository } from './user.repository.interface';
import { RoleService } from '../role/role.service';
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
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }) as UserEntity;

describe('UserService', () => {
  let repository: jest.Mocked<IUserRepository>;
  let roleService: jest.Mocked<Pick<RoleService, 'getByIdOrThrow'>>;
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
    service = new UserService(repository, roleService as never);
  });

  describe('create', () => {
    it('validates the role exists before creating the user', async () => {
      repository.create.mockResolvedValue(buildUser());

      await service.create({ email: 'jane@acme.test', name: 'Jane Doe', roleId: 'role-1' });

      expect(roleService.getByIdOrThrow).toHaveBeenCalledWith('role-1');
      expect(repository.create).toHaveBeenCalled();
    });

    it('maps a unique email violation to ConflictException', async () => {
      const error = new QueryFailedError('insert', [], new Error('duplicate key'));
      (error as unknown as { driverError: { code: string } }).driverError = { code: '23505' };
      repository.create.mockRejectedValue(error);

      await expect(service.create({ email: 'jane@acme.test', name: 'Jane', roleId: 'role-1' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('propagates a role-not-found error without attempting to create', async () => {
      const notFound = new NotFoundException('Role not found');
      roleService.getByIdOrThrow.mockRejectedValue(notFound);

      await expect(service.create({ email: 'jane@acme.test', name: 'Jane', roleId: 'missing' })).rejects.toBe(notFound);
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
    it('validates the new role exists when roleId is provided', async () => {
      repository.update.mockResolvedValue(buildUser({ roleId: 'role-2' }));

      await service.update('user-1', { roleId: 'role-2' });

      expect(roleService.getByIdOrThrow).toHaveBeenCalledWith('role-2');
    });

    it('does not validate a role when roleId is omitted', async () => {
      repository.update.mockResolvedValue(buildUser({ name: 'New Name' }));

      await service.update('user-1', { name: 'New Name' });

      expect(roleService.getByIdOrThrow).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user does not exist', async () => {
      repository.update.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deactivate', () => {
    it('returns a deactivated confirmation', async () => {
      repository.deactivate.mockResolvedValue(buildUser({ isActive: false }));

      const result = await service.deactivate('user-1');

      expect(result).toEqual({ id: 'user-1', deactivated: true });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      repository.deactivate.mockResolvedValue(null);

      await expect(service.deactivate('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
