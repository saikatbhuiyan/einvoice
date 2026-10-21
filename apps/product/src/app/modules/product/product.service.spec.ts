import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
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
    sdRate: 0,
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
      findOne: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
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

      // Only this organization's product lists are invalidated.
      expect(redis.incr).toHaveBeenCalledWith(`svc:org:${ORG}:product:list:version`);
      expect(result).toEqual({
        id: 'product-1',
        sku: 'SKU-1',
        name: 'Widget',
        description: undefined,
        unitPrice: 100,
        currency: 'USD',
        vatRate: 10,
        sdRate: 0,
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

  describe('findOne / update / deactivate', () => {
    const UUID = '3f1b3c9a-7e3d-4a2c-9c1e-6b1a4a9c2f10';

    it('returns the product', async () => {
      repository.findOne.mockResolvedValue(buildProduct({ id: UUID, sdRate: 20 }));

      await expect(service.findOne(UUID)).resolves.toMatchObject({ id: UUID, sdRate: 20 });
      expect(repository.findOne).toHaveBeenCalledWith(UUID);
    });

    // The repository scopes by organization: another organization's product is "not found".
    it("is a 404 for a product that isn't the organization's", async () => {
      repository.findOne.mockResolvedValue(null);
      repository.update.mockResolvedValue(null);

      await expect(service.findOne(UUID)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.update(UUID, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.deactivate(UUID)).rejects.toBeInstanceOf(NotFoundException);
      expect(redis.incr).not.toHaveBeenCalled();
    });

    // Postgres would answer a malformed uuid with a 500; RPC payloads skip DTO validation.
    it('is a 400 for a malformed id, without touching the database', async () => {
      await expect(service.findOne('nope')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update('nope', {})).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.deactivate('nope')).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.findOne).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('update returns the updated product and invalidates the lists', async () => {
      repository.update.mockResolvedValue(buildProduct({ id: UUID, unitPrice: 165 }));

      await expect(service.update(UUID, { unitPrice: 165 })).resolves.toMatchObject({ unitPrice: 165 });
      expect(repository.update).toHaveBeenCalledWith(UUID, { unitPrice: 165 });
      expect(redis.incr).toHaveBeenCalledWith(`svc:org:${ORG}:product:list:version`);
    });

    it('update maps a SKU clash to a 409', async () => {
      const error = new QueryFailedError('update', [], new Error('duplicate key'));
      (error as unknown as { driverError: { code: string } }).driverError = { code: '23505' };
      repository.update.mockRejectedValue(error);

      await expect(service.update(UUID, { sku: 'TAKEN' })).rejects.toThrow(
        new ConflictException('Product with sku "TAKEN" already exists.'),
      );
    });

    it('deactivate is a soft isActive: false', async () => {
      repository.update.mockResolvedValue(buildProduct({ id: UUID, isActive: false }));

      await expect(service.deactivate(UUID)).resolves.toEqual({ id: UUID, deactivated: true });
      expect(repository.update).toHaveBeenCalledWith(UUID, { isActive: false });
    });
  });

  describe('findMany (for invoice lines)', () => {
    it('looks up the distinct well-formed ids, ignoring anything else', async () => {
      const a = '3f1b3c9a-7e3d-4a2c-9c1e-6b1a4a9c2f10';
      const b = '9e2b1d4c-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
      repository.findMany.mockResolvedValue([buildProduct({ id: a })]);

      const result = await service.findMany([a, a, b, 'nope', 42]);

      expect(repository.findMany).toHaveBeenCalledWith([a, b]);
      expect(result).toEqual([expect.objectContaining({ id: a })]);
    });

    it('treats a payload without a list as no ids', async () => {
      repository.findMany.mockResolvedValue([]);

      await expect(service.findMany(undefined)).resolves.toEqual([]);
      expect(repository.findMany).toHaveBeenCalledWith([]);
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
