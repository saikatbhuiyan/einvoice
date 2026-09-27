import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ProductService } from './product.service';
import { IProductRepository } from './product.repository.interface';
import { ProductEntity } from '../../../database/entities/product.entity';

type MockCache = { get: jest.Mock; set: jest.Mock; del: jest.Mock };
type MockRedis = { get: jest.Mock; incr: jest.Mock };

const buildProduct = (overrides: Partial<ProductEntity> = {}): ProductEntity =>
  ({
    id: 'product-1',
    sku: 'SKU-1',
    name: 'Widget',
    description: undefined,
    unitPrice: 100,
    currency: 'USD',
    vatRate: 10,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }) as ProductEntity;

describe('ProductService', () => {
  let repository: jest.Mocked<IProductRepository>;
  let cacheManager: MockCache;
  let redis: MockRedis;
  let service: ProductService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findAll: jest.fn(),
    };
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    redis = { get: jest.fn().mockResolvedValue(null), incr: jest.fn().mockResolvedValue(1) };

    service = new ProductService(repository, cacheManager as never, redis as never);
  });

  describe('create', () => {
    it('persists, bumps the list version, and returns the created product', async () => {
      const created = buildProduct();
      repository.create.mockResolvedValue(created);

      const result = await service.create({
        sku: 'SKU-1',
        name: 'Widget',
        unitPrice: 100,
        currency: 'USD',
        vatRate: 10,
      });

      expect(redis.incr).toHaveBeenCalled();
      expect(result).toEqual({
        id: 'product-1',
        sku: 'SKU-1',
        name: 'Widget',
        description: undefined,
        unitPrice: 100,
        currency: 'USD',
        vatRate: 10,
        isActive: true,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      });
    });

    it('maps a unique SKU violation to ConflictException', async () => {
      const error = new QueryFailedError('insert', [], new Error('duplicate key'));
      (error as unknown as { driverError: { code: string } }).driverError = { code: '23505' };
      repository.create.mockRejectedValue(error);

      await expect(
        service.create({ sku: 'SKU-1', name: 'Widget', unitPrice: 100, currency: 'USD', vatRate: 10 }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('rethrows unrecognized errors as-is', async () => {
      const unexpected = new Error('boom');
      repository.create.mockRejectedValue(unexpected);

      await expect(
        service.create({ sku: 'SKU-1', name: 'Widget', unitPrice: 100, currency: 'USD', vatRate: 10 }),
      ).rejects.toBe(unexpected);
    });
  });

  describe('findAll', () => {
    it('maps entities to responses and builds pagination meta', async () => {
      repository.findAll.mockResolvedValue({ items: [buildProduct()], total: 1 });

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('product-1');
      expect(result.meta).toMatchObject({ page: 1, limit: 20, total: 1 });
    });

    it('defaults pagination meta when page/limit are omitted', async () => {
      repository.findAll.mockResolvedValue({ items: [], total: 0 });

      const result = await service.findAll({});

      expect(result.meta.page).toBeDefined();
      expect(result.meta.limit).toBeDefined();
    });

    it('returns a cached response without hitting the repository on a cache hit', async () => {
      const cached = { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result).toBe(cached);
      expect(repository.findAll).not.toHaveBeenCalled();
    });

    it('writes the result to cache on a miss', async () => {
      repository.findAll.mockResolvedValue({ items: [buildProduct()], total: 1 });

      await service.findAll({ page: 1, limit: 20 });

      expect(cacheManager.set).toHaveBeenCalled();
    });
  });
});
