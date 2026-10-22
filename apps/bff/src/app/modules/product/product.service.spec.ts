import { ServiceUnavailableException } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductClientService } from './product-client.service';
// Tenant cache keys need an organization in context, as every real request has.
import { itInOrganization as it } from '@libs/logging/testing';

type MockCache = { get: jest.Mock; set: jest.Mock };
type MockRedis = { get: jest.Mock; incr: jest.Mock };
type MockClient = jest.Mocked<
  Pick<
    ProductClientService,
    'createProduct' | 'findAllProducts' | 'findProduct' | 'updateProduct' | 'deactivateProduct'
  >
>;
type MockCbFactory = { get: jest.Mock };

describe('BFF ProductService', () => {
  let client: MockClient;
  let cacheManager: MockCache;
  let redis: MockRedis;
  let cbFactory: MockCbFactory;
  let service: ProductService;

  beforeEach(() => {
    client = {
      createProduct: jest.fn(),
      findAllProducts: jest.fn(),
      findProduct: jest.fn(),
      updateProduct: jest.fn(),
      deactivateProduct: jest.fn(),
    };
    cacheManager = { get: jest.fn(), set: jest.fn() };
    redis = { get: jest.fn().mockResolvedValue(null), incr: jest.fn().mockResolvedValue(1) };
    cbFactory = { get: jest.fn() };

    service = new ProductService(client as never, cacheManager as never, redis as never, cbFactory as never);
  });

  describe('create', () => {
    it('bumps the list version after creating', async () => {
      client.createProduct.mockResolvedValue({ id: 'product-1' } as never);

      await service.create({ sku: 'SKU-1' } as never);

      expect(redis.incr).toHaveBeenCalled();
    });
  });

  describe('findOne / update / deactivate', () => {
    // Someone about to invoice a product must see its current price and status.
    it('reads one product fresh, never from cache', async () => {
      client.findProduct.mockResolvedValue({ id: 'product-1' } as never);

      await expect(service.findOne('product-1')).resolves.toEqual({ id: 'product-1' });
      expect(cacheManager.get).not.toHaveBeenCalled();
    });

    it('invalidates the cached lists after an update or a deactivation', async () => {
      client.updateProduct.mockResolvedValue({ id: 'product-1' } as never);
      client.deactivateProduct.mockResolvedValue({ id: 'product-1', deactivated: true });

      await service.update('product-1', { unitPrice: 165 });
      await service.deactivate('product-1');

      expect(client.updateProduct).toHaveBeenCalledWith('product-1', { unitPrice: 165 });
      expect(client.deactivateProduct).toHaveBeenCalledWith('product-1');
      expect(redis.incr).toHaveBeenCalledTimes(2);
    });

    it('leaves the lists alone when the update fails', async () => {
      client.updateProduct.mockRejectedValue(new Error('boom'));

      await expect(service.update('product-1', {})).rejects.toThrow('boom');
      expect(redis.incr).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns a cached list without calling the RPC client', async () => {
      const cached = { items: [], meta: {} };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.findAll({});

      expect(result).toBe(cached);
      expect(client.findAllProducts).not.toHaveBeenCalled();
    });

    it('caches a fresh lookup from the client', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      const fresh = { items: [{ id: 'product-1' }], meta: {} };
      client.findAllProducts.mockResolvedValue(fresh as never);

      const result = await service.findAll({});

      expect(result).toBe(fresh);
      expect(cacheManager.set).toHaveBeenCalled();
    });

    it('falls back to cache and marks the response when the circuit is open', async () => {
      cacheManager.get.mockResolvedValueOnce(undefined);
      client.findAllProducts.mockRejectedValue(new ServiceUnavailableException('product service unavailable'));
      cbFactory.get.mockReturnValue({ getMetrics: () => ({ state: 'OPEN' }) });
      const stale = { items: [], meta: {}, stale: true };
      cacheManager.get.mockResolvedValueOnce(stale);
      const res = { setHeader: jest.fn() } as never;

      const result = await service.findAll({}, res);

      expect(result).toBe(stale);
      expect((res as { setHeader: jest.Mock }).setHeader).toHaveBeenCalledWith('X-Served-From', 'cache');
    });
  });
});
