import type { HttpService } from '@nestjs/axios';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { KeycloakAdminConfiguration } from './keycloak-admin.config';
import { KeycloakAdminService } from './keycloak-admin.service';

const ADMIN = 'http://keycloak:8080/admin/realms/einvoice';
const TOKEN_URL = 'http://keycloak:8080/realms/einvoice/protocol/openid-connect/token';

function buildConfig(): KeycloakAdminConfiguration {
  const config = new KeycloakAdminConfiguration();
  config.BASE_URL = 'http://keycloak:8080';
  config.REALM = 'einvoice';
  config.ADMIN_CLIENT_ID = 'einvoice-admin-cli';
  config.ADMIN_CLIENT_SECRET = 'secret';
  return config;
}

describe('KeycloakAdminService', () => {
  let http: { post: jest.Mock; get: jest.Mock; put: jest.Mock; delete: jest.Mock };
  let service: KeycloakAdminService;

  const tokenResponse = (token = 'admin-token', expiresIn = 300) =>
    of({ data: { access_token: token, expires_in: expiresIn } });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    http = { post: jest.fn(), get: jest.fn(), put: jest.fn(), delete: jest.fn() };
    const configService = { get: () => buildConfig() } as unknown as ConfigService;
    service = new KeycloakAdminService(http as unknown as HttpService, configService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('admin token', () => {
    it('requests a client-credentials token once and reuses it while still valid', async () => {
      http.post.mockImplementation((url: string) =>
        url === TOKEN_URL ? tokenResponse() : of({ headers: { location: `${ADMIN}/users/kc-1` } }),
      );
      http.put.mockReturnValue(of({}));

      await service.setEnabled('kc-1', false);
      await service.setEnabled('kc-1', true);

      const tokenCalls = http.post.mock.calls.filter(([url]) => url === TOKEN_URL);
      expect(tokenCalls).toHaveLength(1);
      expect(tokenCalls[0][1]).toBe('grant_type=client_credentials&client_id=einvoice-admin-cli&client_secret=secret');
    });

    it('refreshes the token 30s before Keycloak says it expires', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      http.post.mockReturnValue(tokenResponse('first', 60));
      http.put.mockReturnValue(of({}));

      await service.setEnabled('kc-1', true);
      now.mockReturnValue(1_000_000 + 29_000);
      await service.setEnabled('kc-1', true);
      expect(http.post).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + 31_000);
      await service.setEnabled('kc-1', true);
      expect(http.post).toHaveBeenCalledTimes(2);
    });

    it('fails with a generic 500 when the token request fails, without leaking the upstream body', async () => {
      http.post.mockReturnValue(throwError(() => new Error('invalid_client')));

      await expect(service.setEnabled('kc-1', true)).rejects.toThrow(
        new InternalServerErrorException('Failed to authenticate with the identity provider.'),
      );
    });
  });

  describe('createUser', () => {
    beforeEach(() => http.post.mockImplementationOnce(() => tokenResponse()));

    it('returns the new user id from the Location header (Keycloak sends no body)', async () => {
      http.post.mockReturnValueOnce(of({ headers: { location: `${ADMIN}/users/9b1c-uuid` } }));

      await expect(service.createUser({ username: 'jane', email: 'jane@acme.test' })).resolves.toBe('9b1c-uuid');

      const [url, body, options] = http.post.mock.calls[1];
      expect(url).toBe(`${ADMIN}/users`);
      expect(body).toMatchObject({ username: 'jane', enabled: true, requiredActions: ['UPDATE_PASSWORD'] });
      expect(options.headers.Authorization).toBe('Bearer admin-token');
    });

    it('fails when Keycloak returns no Location header', async () => {
      http.post.mockReturnValueOnce(of({ headers: {} }));

      await expect(service.createUser({ username: 'jane', email: 'jane@acme.test' })).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('maps an upstream failure to a generic 500', async () => {
      http.post.mockReturnValueOnce(throwError(() => new Error('409 Conflict')));

      await expect(service.createUser({ username: 'jane', email: 'jane@acme.test' })).rejects.toThrow(
        'Failed to provision the identity for this user.',
      );
    });
  });

  describe('realm roles', () => {
    const role = { id: 'role-uuid', name: 'accountant' };

    beforeEach(() => {
      http.post.mockImplementation((url: string) => (url === TOKEN_URL ? tokenResponse() : of({})));
      http.get.mockReturnValue(of({ data: role }));
      http.delete.mockReturnValue(of({}));
    });

    it('assigns a role by looking up its representation and posting it to the user’s mappings', async () => {
      await service.assignRealmRole('kc-1', 'accountant');

      expect(http.get).toHaveBeenCalledWith(`${ADMIN}/roles/accountant`, expect.anything());
      expect(http.post).toHaveBeenCalledWith(`${ADMIN}/users/kc-1/role-mappings/realm`, [role], expect.anything());
    });

    it('removes a role with a DELETE carrying the role representation as the body', async () => {
      await service.removeRealmRole('kc-1', 'accountant');

      expect(http.delete).toHaveBeenCalledWith(
        `${ADMIN}/users/kc-1/role-mappings/realm`,
        expect.objectContaining({ data: [role] }),
      );
    });

    it('fails with a generic 500 when the role lookup fails', async () => {
      http.get.mockReturnValue(throwError(() => new Error('403 Forbidden')));

      await expect(service.assignRealmRole('kc-1', 'accountant')).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('deleteUser (saga compensation)', () => {
    beforeEach(() => http.post.mockReturnValue(tokenResponse()));

    it('deletes the Keycloak user', async () => {
      http.delete.mockReturnValue(of({}));

      await service.deleteUser('kc-1');

      expect(http.delete).toHaveBeenCalledWith(`${ADMIN}/users/kc-1`, expect.anything());
    });

    it('swallows its own failure so it never masks the error that triggered the rollback', async () => {
      http.delete.mockReturnValue(throwError(() => new Error('500')));

      await expect(service.deleteUser('kc-1')).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });
});
