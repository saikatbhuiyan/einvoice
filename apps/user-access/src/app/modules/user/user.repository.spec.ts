import { UserRepository } from './user.repository';

describe('UserRepository', () => {
  let typeormRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    exists: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let repository: UserRepository;

  beforeEach(() => {
    typeormRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      exists: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    repository = new UserRepository(typeormRepo as never);
  });

  describe('create', () => {
    it('saves the user then re-fetches it (to populate the eager role relation)', async () => {
      typeormRepo.save.mockResolvedValue({ id: 'user-1' });
      const refetched = { id: 'user-1', role: { id: 'role-1' } };
      typeormRepo.findOne.mockResolvedValue(refetched);

      const result = await repository.create({ email: 'jane@acme.test', name: 'Jane', roleId: 'role-1' });

      expect(typeormRepo.save).toHaveBeenCalled();
      expect(typeormRepo.findOne).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(result).toBe(refetched);
    });
  });

  describe('findAll', () => {
    const buildQueryBuilder = (result: [unknown[], number]) => {
      const qb: Record<string, jest.Mock> = {};
      qb['leftJoinAndSelect'] = jest.fn(() => qb);
      qb['andWhere'] = jest.fn(() => qb);
      qb['orderBy'] = jest.fn(() => qb);
      qb['skip'] = jest.fn(() => qb);
      qb['take'] = jest.fn(() => qb);
      qb['getManyAndCount'] = jest.fn().mockResolvedValue(result);
      return qb;
    };

    it('left-joins the role relation and applies filters', async () => {
      const qb = buildQueryBuilder([[{ id: 'user-1' }], 1]);
      typeormRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await repository.findAll({ page: 1, limit: 10, roleId: 'role-1', isActive: true, search: 'jane' });

      expect(qb['leftJoinAndSelect']).toHaveBeenCalledWith('user.role', 'role');
      expect(qb['andWhere']).toHaveBeenCalledWith('user.roleId = :roleId', { roleId: 'role-1' });
      expect(qb['andWhere']).toHaveBeenCalledWith('user.isActive = :isActive', { isActive: true });
      expect(qb['andWhere']).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), { search: '%jane%' });
      expect(result).toEqual({ items: [{ id: 'user-1' }], total: 1 });
    });
  });

  describe('update', () => {
    it('returns null when the user does not exist', async () => {
      typeormRepo.exists.mockResolvedValue(false);

      const result = await repository.update('missing', { name: 'X' });

      expect(result).toBeNull();
      expect(typeormRepo.update).not.toHaveBeenCalled();
    });

    it('applies a direct column update and re-fetches (never load+merge+save)', async () => {
      typeormRepo.exists.mockResolvedValue(true);
      const refetched = { id: 'user-1', role: { id: 'role-2' } };
      typeormRepo.findOne.mockResolvedValue(refetched);

      const result = await repository.update('user-1', { roleId: 'role-2' });

      expect(typeormRepo.update).toHaveBeenCalledWith('user-1', { roleId: 'role-2' });
      expect(typeormRepo.save).not.toHaveBeenCalled();
      expect(result).toBe(refetched);
    });
  });

  describe('deactivate', () => {
    it('returns null when the user does not exist', async () => {
      typeormRepo.exists.mockResolvedValue(false);

      const result = await repository.deactivate('missing');

      expect(result).toBeNull();
    });

    it('sets isActive to false via a direct update', async () => {
      typeormRepo.exists.mockResolvedValue(true);
      const refetched = { id: 'user-1', isActive: false };
      typeormRepo.findOne.mockResolvedValue(refetched);

      const result = await repository.deactivate('user-1');

      expect(typeormRepo.update).toHaveBeenCalledWith('user-1', { isActive: false });
      expect(result).toBe(refetched);
    });
  });
});
