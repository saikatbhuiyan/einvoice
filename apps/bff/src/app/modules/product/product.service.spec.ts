import { ServiceUnavailableException } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductClientService } from './product-client.service';

type MockCache = { get: jest.Mock; set: jest.Mock };
type MockRedis = { get: jest.Mock; incr: jest.Mock };
type MockClient = jest.Mocked<Pick<ProductClientService, 'createProduct' | 'findAllProducts'>>;
type MockCbFactory = { get: jest.Mock };

describe('BFF ProductService', () => {
  let client: MockClient;
  let cacheManager: MockCache;
  let redis: MockRedis;
  let cbFactory: MockCbFactory;
  let service: ProductService;

  beforeEach(() => {
    client = { createProduct: jest.fn(), findAllProducts: jest.fn() };
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
