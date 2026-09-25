import { ProductRepository } from './product.repository';

describe('ProductRepository', () => {
  let typeormRepo: { create: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock };
  let repository: ProductRepository;

  beforeEach(() => {
    typeormRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    repository = new ProductRepository(typeormRepo as never);
  });

  describe('create', () => {
    it('defaults isActive to true when not provided', async () => {
      typeormRepo.save.mockResolvedValue({ id: 'product-1' });

      await repository.create({ sku: 'SKU-1', name: 'Widget', unitPrice: 100, currency: 'USD', vatRate: 10 });

      expect(typeormRepo.create).toHaveBeenCalledWith(expect.objectContaining({ sku: 'SKU-1', isActive: true }));
      expect(typeormRepo.save).toHaveBeenCalled();
    });

    it('respects an explicit isActive value', async () => {
      typeormRepo.save.mockResolvedValue({ id: 'product-1' });

      await repository.create({
        sku: 'SKU-1',
        name: 'Widget',
        unitPrice: 100,
        currency: 'USD',
        vatRate: 10,
        isActive: false,
      });

      expect(typeormRepo.create).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
    });
  });

  describe('findAll', () => {
    const buildQueryBuilder = (result: [unknown[], number]) => {
      const qb: Record<string, jest.Mock> = {};
      qb['andWhere'] = jest.fn(() => qb);
      qb['orderBy'] = jest.fn(() => qb);
      qb['skip'] = jest.fn(() => qb);
      qb['take'] = jest.fn(() => qb);
      qb['getManyAndCount'] = jest.fn().mockResolvedValue(result);
      return qb;
    };

    it('applies isActive and search filters and paginates', async () => {
      const qb = buildQueryBuilder([[{ id: 'product-1' }], 1]);
      typeormRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await repository.findAll({ page: 2, limit: 10, isActive: true, search: 'widget' });

      expect(qb['andWhere']).toHaveBeenCalledWith('product.isActive = :isActive', { isActive: true });
      expect(qb['andWhere']).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), { search: '%widget%' });
      expect(qb['skip']).toHaveBeenCalledWith(10);
      expect(qb['take']).toHaveBeenCalledWith(10);
      expect(result).toEqual({ items: [{ id: 'product-1' }], total: 1 });
    });

    it('applies no filters when none are given', async () => {
      const qb = buildQueryBuilder([[], 0]);
      typeormRepo.createQueryBuilder.mockReturnValue(qb);

      await repository.findAll({});

      expect(qb['andWhere']).not.toHaveBeenCalled();
    });
  });
});
