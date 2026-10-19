import type { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { JwksCacheService } from './jwks-cache.service';

const getSigningKey = jest.fn();

jest.mock('jwks-rsa', () => ({
  JwksClient: jest.fn().mockImplementation(() => ({ getSigningKey })),
}));

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe('JwksCacheService', () => {
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: JwksCacheService;

  beforeEach(() => {
    getSigningKey.mockReset();
    cache = { get: jest.fn(), set: jest.fn().mockResolvedValue(undefined) };
    const config = { get: () => ({ jwksUri: 'http://keycloak:8080/realms/einvoice/protocol/openid-connect/certs' }) };
    service = new JwksCacheService(cache as unknown as Cache, config as unknown as ConfigService);
  });

  it('returns the live key and persists it as a one-hour fallback', async () => {
    getSigningKey.mockResolvedValue({ getPublicKey: () => 'PEM-LIVE' });

    await expect(service.getSigningKey('kid-1')).resolves.toBe('PEM-LIVE');
    expect(cache.set).toHaveBeenCalledWith('keycloak:jwks:key:kid-1', 'PEM-LIVE', 60 * 60 * 1000);
  });

  it('does not fail a successful verification when writing the fallback copy fails', async () => {
    getSigningKey.mockResolvedValue({ getPublicKey: () => 'PEM-LIVE' });
    cache.set.mockRejectedValue(new Error('redis down'));

    await expect(service.getSigningKey('kid-1')).resolves.toBe('PEM-LIVE');
    await flushMicrotasks();
  });

  it('falls back to the last known-good key when Keycloak is unreachable', async () => {
    getSigningKey.mockRejectedValue(new Error('ECONNREFUSED'));
    cache.get.mockResolvedValue('PEM-CACHED');

    await expect(service.getSigningKey('kid-1')).resolves.toBe('PEM-CACHED');
    expect(cache.get).toHaveBeenCalledWith('keycloak:jwks:key:kid-1');
  });

  it('rethrows the original JWKS error when there is no fallback for that kid', async () => {
    getSigningKey.mockRejectedValue(new Error('ECONNREFUSED'));
    cache.get.mockResolvedValue(undefined);

    await expect(service.getSigningKey('kid-unknown')).rejects.toThrow('ECONNREFUSED');
  });

  it('rethrows the original JWKS error when Redis is down too, not the Redis error', async () => {
    getSigningKey.mockRejectedValue(new Error('ECONNREFUSED'));
    cache.get.mockRejectedValue(new Error('redis down'));

    await expect(service.getSigningKey('kid-1')).rejects.toThrow('ECONNREFUSED');
  });
});
