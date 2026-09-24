import { ServiceUnavailableException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { InvoiceClientService } from './invoice-client.service';

type MockCache = { get: jest.Mock; set: jest.Mock; del: jest.Mock };
type MockRedis = { get: jest.Mock; incr: jest.Mock };
type MockClient = jest.Mocked<
  Pick<InvoiceClientService, 'findOneInvoice' | 'findAllInvoices' | 'createInvoice' | 'updateInvoice' | 'removeInvoice'>
>;
type MockCbFactory = { get: jest.Mock };

describe('BFF InvoiceService', () => {
  let client: MockClient;
  let cacheManager: MockCache;
  let redis: MockRedis;
  let cbFactory: MockCbFactory;
  let service: InvoiceService;

  beforeEach(() => {
    client = {
      findOneInvoice: jest.fn(),
      findAllInvoices: jest.fn(),
      createInvoice: jest.fn(),
      updateInvoice: jest.fn(),
      removeInvoice: jest.fn(),
    };
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    redis = { get: jest.fn().mockResolvedValue(null), incr: jest.fn().mockResolvedValue(1) };
    cbFactory = { get: jest.fn() };

    service = new InvoiceService(client as never, cacheManager as never, redis as never, cbFactory as never);
  });

  describe('findOne', () => {
    it('returns a cached invoice without calling the RPC client', async () => {
      const cached = { id: 'invoice-1' };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.findOne('invoice-1');

      expect(result).toBe(cached);
      expect(client.findOneInvoice).not.toHaveBeenCalled();
    });

    it('caches a fresh lookup from the client', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      const fresh = { id: 'invoice-1' };
      client.findOneInvoice.mockResolvedValue(fresh as never);

      const result = await service.findOne('invoice-1');

      expect(result).toBe(fresh);
      expect(cacheManager.set).toHaveBeenCalled();
    });

    it('falls back to a cached value and marks the response when the circuit is open', async () => {
      cacheManager.get.mockResolvedValueOnce(undefined);
      client.findOneInvoice.mockRejectedValue(new ServiceUnavailableException('invoice service unavailable'));
      cbFactory.get.mockReturnValue({ getMetrics: () => ({ state: 'OPEN' }) });
      const stale = { id: 'invoice-1', stale: true };
      cacheManager.get.mockResolvedValueOnce(stale);
      const res = { setHeader: jest.fn() } as never;

      const result = await service.findOne('invoice-1', res);

      expect(result).toBe(stale);
      expect((res as { setHeader: jest.Mock }).setHeader).toHaveBeenCalledWith('X-Served-From', 'cache');
      expect((res as { setHeader: jest.Mock }).setHeader).toHaveBeenCalledWith('X-Circuit-State', 'OPEN');
    });

    it('rethrows when the circuit is open and there is no cached fallback', async () => {
      cacheManager.get.mockResolvedValueOnce(undefined);
      const error = new ServiceUnavailableException('invoice service unavailable');
      client.findOneInvoice.mockRejectedValue(error);
      cbFactory.get.mockReturnValue({ getMetrics: () => ({ state: 'OPEN' }) });
      cacheManager.get.mockResolvedValueOnce(undefined);

      await expect(service.findOne('invoice-1')).rejects.toBe(error);
    });
  });

  describe('write operations invalidate cache', () => {
    it('create bumps the list version', async () => {
      client.createInvoice.mockResolvedValue({ id: 'invoice-1' } as never);

      await service.create({ invoiceNumber: 'INV-0001' } as never);

      expect(redis.incr).toHaveBeenCalled();
    });

    it('update deletes the entity cache entry and bumps the list version', async () => {
      client.updateInvoice.mockResolvedValue({ id: 'invoice-1' } as never);

      await service.update('invoice-1', {});

      expect(cacheManager.del).toHaveBeenCalled();
      expect(redis.incr).toHaveBeenCalled();
    });

    it('remove deletes the entity cache entry and bumps the list version', async () => {
      client.removeInvoice.mockResolvedValue({ id: 'invoice-1', deleted: true } as never);

      await service.remove('invoice-1');

      expect(cacheManager.del).toHaveBeenCalled();
      expect(redis.incr).toHaveBeenCalled();
    });
  });
});
