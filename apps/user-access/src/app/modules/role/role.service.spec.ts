import { NotFoundException } from '@nestjs/common';
import { RoleService } from './role.service';
import { IRoleRepository } from './role.repository.interface';
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

describe('RoleService', () => {
  let repository: jest.Mocked<IRoleRepository>;
  let service: RoleService;

  beforeEach(() => {
    repository = { findAll: jest.fn(), findById: jest.fn() };
    service = new RoleService(repository);
  });

  describe('findAll', () => {
    it('maps role entities to role responses', async () => {
      repository.findAll.mockResolvedValue([buildRole()]);

      const result = await service.findAll();

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ id: 'role-1', name: 'accountant', permissions: ['invoice:read'] });
    });
  });

  describe('getByIdOrThrow', () => {
    it('returns the role when found', async () => {
      const role = buildRole();
      repository.findById.mockResolvedValue(role);

      await expect(service.getByIdOrThrow('role-1')).resolves.toBe(role);
    });

    it('throws NotFoundException when the role does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getByIdOrThrow('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
