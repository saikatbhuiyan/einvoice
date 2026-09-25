import { ServiceUnavailableException } from '@nestjs/common';
import { UserService } from './user.service';
import { UserClientService } from './user-client.service';

type MockCache = { get: jest.Mock; set: jest.Mock };
type MockRedis = { get: jest.Mock; incr: jest.Mock };
type MockClient = jest.Mocked<
  Pick<
    UserClientService,
    'createUser' | 'findAllUsers' | 'findOneUser' | 'updateUser' | 'deactivateUser' | 'findAllRoles'
  >
>;
type MockCbFactory = { get: jest.Mock };

describe('BFF UserService', () => {
  let client: MockClient;
  let cacheManager: MockCache;
  let redis: MockRedis;
  let cbFactory: MockCbFactory;
  let service: UserService;

  beforeEach(() => {
    client = {
      createUser: jest.fn(),
      findAllUsers: jest.fn(),
      findOneUser: jest.fn(),
      updateUser: jest.fn(),
      deactivateUser: jest.fn(),
      findAllRoles: jest.fn(),
    };
    cacheManager = { get: jest.fn(), set: jest.fn() };
    redis = { get: jest.fn().mockResolvedValue(null), incr: jest.fn().mockResolvedValue(1) };
    cbFactory = { get: jest.fn() };

    service = new UserService(client as never, cacheManager as never, redis as never, cbFactory as never);
  });

  describe('create', () => {
    it('bumps the list version after creating', async () => {
      client.createUser.mockResolvedValue({ id: 'user-1' } as never);

      await service.create({ email: 'jane@acme.test' } as never);

      expect(redis.incr).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns a cached list without calling the RPC client', async () => {
      const cached = { items: [], meta: {} };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.findAll({});

      expect(result).toBe(cached);
      expect(client.findAllUsers).not.toHaveBeenCalled();
    });

    it('falls back to cache when the circuit is open', async () => {
      cacheManager.get.mockResolvedValueOnce(undefined);
      client.findAllUsers.mockRejectedValue(new ServiceUnavailableException('user service unavailable'));
      cbFactory.get.mockReturnValue({ getMetrics: () => ({ state: 'OPEN' }) });
      const stale = { items: [], meta: {}, stale: true };
      cacheManager.get.mockResolvedValueOnce(stale);

      const result = await service.findAll({});

      expect(result).toBe(stale);
    });
  });

  describe('update / deactivate', () => {
    it('update bumps the list version', async () => {
      client.updateUser.mockResolvedValue({ id: 'user-1' } as never);

      await service.update('user-1', { name: 'New Name' });

      expect(redis.incr).toHaveBeenCalled();
    });

    it('deactivate bumps the list version', async () => {
      client.deactivateUser.mockResolvedValue({ id: 'user-1', deactivated: true } as never);

      await service.deactivate('user-1');

      expect(redis.incr).toHaveBeenCalled();
    });
  });

  describe('findAllRoles', () => {
    it('returns a cached role list without calling the RPC client', async () => {
      const cached = { items: [{ id: 'role-1' }] };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.findAllRoles();

      expect(result).toBe(cached);
      expect(client.findAllRoles).not.toHaveBeenCalled();
    });

    it('caches a fresh lookup from the client', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      const fresh = { items: [{ id: 'role-1' }] };
      client.findAllRoles.mockResolvedValue(fresh as never);

      const result = await service.findAllRoles();

      expect(result).toBe(fresh);
      expect(cacheManager.set).toHaveBeenCalled();
    });
  });
});
