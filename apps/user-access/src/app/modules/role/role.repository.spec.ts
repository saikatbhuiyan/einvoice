import { RoleRepository } from './role.repository';

describe('RoleRepository', () => {
  let typeormRepo: { find: jest.Mock; findOne: jest.Mock };
  let repository: RoleRepository;

  beforeEach(() => {
    typeormRepo = { find: jest.fn(), findOne: jest.fn() };
    repository = new RoleRepository(typeormRepo as never);
  });

  it('findAll queries only active roles, ordered by name', async () => {
    typeormRepo.find.mockResolvedValue([]);

    await repository.findAll();

    expect(typeormRepo.find).toHaveBeenCalledWith({ where: { isActive: true }, order: { name: 'ASC' } });
  });

  it('findById queries by id', async () => {
    const role = { id: 'role-1' };
    typeormRepo.findOne.mockResolvedValue(role);

    const result = await repository.findById('role-1');

    expect(typeormRepo.findOne).toHaveBeenCalledWith({ where: { id: 'role-1' } });
    expect(result).toBe(role);
  });
});
