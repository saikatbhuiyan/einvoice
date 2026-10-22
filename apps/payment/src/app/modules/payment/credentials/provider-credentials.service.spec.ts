import { randomBytes } from 'crypto';

const KEY = randomBytes(32).toString('base64');

import { NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
import { ProviderCredentialsService } from './provider-credentials.service';
import { CredentialCipher } from './credential-cipher';
import { SslCommerzUnavailableError } from '../sslcommerz/sslcommerz.client';

describe('ProviderCredentialsService', () => {
  let repository: { exists: jest.Mock; upsert: jest.Mock; update: jest.Mock; findOne: jest.Mock };
  let client: { checkCredentials: jest.Mock };
  let service: ProviderCredentialsService;

  const stored = (fields: Record<string, unknown> = {}) => ({
    organizationId: ORG,
    provider: 'sslcommerz',
    accountId: 'testbox',
    secretCiphertext: new CredentialCipher(KEY).encrypt('qwerty'),
    keyId: new CredentialCipher(KEY).keyId,
    sandbox: true,
    disabledAt: null,
    updatedAt: new Date('2026-10-22T10:00:00.000Z'),
    ...fields,
  });

  beforeEach(() => {
    repository = {
      exists: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn().mockResolvedValue(stored()),
    };
    client = { checkCredentials: jest.fn().mockResolvedValue(true) };
    service = new ProviderCredentialsService(repository as never, client as never, { credentialsKey: KEY });
  });

  describe('setSslCommerz', () => {
    it('checks the credentials with SSLCommerz, then stores the password only encrypted', async () => {
      await expect(
        service.setSslCommerz({ storeId: 'testbox', storePassword: 'qwerty', sandbox: true }),
      ).resolves.toEqual({
        provider: 'sslcommerz',
        storeId: 'testbox',
        sandbox: true,
        configuredAt: new Date('2026-10-22T10:00:00.000Z'),
      });

      expect(client.checkCredentials).toHaveBeenCalledWith({
        storeId: 'testbox',
        storePassword: 'qwerty',
        sandbox: true,
      });
      const [row, options] = repository.upsert.mock.calls[0];
      expect(row).toMatchObject({
        organizationId: ORG,
        provider: 'sslcommerz',
        accountId: 'testbox',
        sandbox: true,
        disabledAt: null,
      });
      expect(row.secretCiphertext).not.toContain('qwerty');
      expect(new CredentialCipher(KEY).decrypt(row.secretCiphertext)).toBe('qwerty');
      expect(options).toEqual({ conflictPaths: ['organizationId', 'provider'] });
    });

    it('refuses credentials SSLCommerz refuses, storing nothing (422)', async () => {
      client.checkCredentials.mockResolvedValue(false);

      await expect(
        service.setSslCommerz({ storeId: 'testbox', storePassword: 'wrong', sandbox: true }),
      ).rejects.toThrow(
        new UnprocessableEntityException(
          'SSLCommerz refused these sandbox store credentials (wrong, or the store is inactive).',
        ),
      );
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('is a 503, not a refusal, when SSLCommerz cannot be reached', async () => {
      client.checkCredentials.mockRejectedValue(new SslCommerzUnavailableError('fetch failed'));

      await expect(
        service.setSslCommerz({ storeId: 'testbox', storePassword: 'qwerty', sandbox: true }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    // Re-checked here: RPC payloads skip DTO validation.
    it.each([
      [{ storeId: 'has spaces', storePassword: 'x', sandbox: true }, /storeId/],
      [{ storeId: 'testbox', storePassword: '', sandbox: true }, /storePassword/],
      [{ storeId: 'testbox', storePassword: 'x', sandbox: 'yes' }, /sandbox/],
      [undefined, /storeId/],
    ] as [unknown, RegExp][])('refuses %j before calling SSLCommerz', async (request, message) => {
      await expect(service.setSslCommerz(request as never)).rejects.toThrow(message);
      expect(client.checkCredentials).not.toHaveBeenCalled();
    });

    it('is a 503 when the server has no credentials key', async () => {
      service = new ProviderCredentialsService(repository as never, client as never, {});

      await expect(
        service.setSslCommerz({ storeId: 'testbox', storePassword: 'qwerty', sandbox: true }),
      ).rejects.toThrow('SSLCommerz is not set up on this server (PAYMENT_CREDENTIALS_KEY is missing).');
    });
  });

  it('never returns the password', async () => {
    const response = await service.getSslCommerz();

    expect(JSON.stringify(response)).not.toMatch(/qwerty|secret|v1:/);
  });

  describe('disconnecting', () => {
    // A payer may still finish a session started through the store; confirming it needs the credentials.
    it('disables the store rather than deleting it', async () => {
      repository.update.mockResolvedValue({ affected: 1 });

      await expect(service.deleteSslCommerz()).resolves.toEqual({ provider: 'sslcommerz', deleted: true });
      expect(repository.update).toHaveBeenCalledWith(
        { organizationId: ORG, provider: 'sslcommerz', disabledAt: IsNull() },
        { disabledAt: expect.any(Date) },
      );
    });

    it('is a 404 when no store is connected', async () => {
      repository.update.mockResolvedValue({ affected: 0 });

      await expect(service.deleteSslCommerz()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('routes new checkouts away from a disabled store, but still settles with it', async () => {
      await service.hasSslCommerz();
      expect(repository.exists).toHaveBeenCalledWith({
        where: { organizationId: ORG, provider: 'sslcommerz', disabledAt: IsNull() },
      });

      await expect(service.resolveSslCommerz({ forSettlement: true })).resolves.toEqual({
        storeId: 'testbox',
        storePassword: 'qwerty',
        sandbox: true,
      });
      expect(repository.findOne).toHaveBeenLastCalledWith({ where: { organizationId: ORG, provider: 'sslcommerz' } });

      await service.resolveSslCommerz();
      expect(repository.findOne).toHaveBeenLastCalledWith({
        where: { organizationId: ORG, provider: 'sslcommerz', disabledAt: IsNull() },
      });
    });
  });
});
