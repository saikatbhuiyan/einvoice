import { HttpService } from '@nestjs/axios';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { KeycloakAdminConfiguration } from './keycloak-admin.config';

interface KeycloakAdminTokenResponse {
  access_token: string;
  expires_in: number;
}

interface KeycloakRoleRepresentation {
  id: string;
  name: string;
}

export interface CreateKeycloakUserInput {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

const TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS = 30;

/**
 * Thin wrapper over Keycloak's Admin REST API, authenticated as `einvoice-admin-cli` (a
 * client-credentials-only client, never used for end-user login — see keycloak-admin.config.ts).
 * Deliberately does not set a password on the users it creates: this project's own design decision
 * (see UserEntity's "no password field" note in CLAUDE.md) is that credential storage is out of
 * scope, and setting one here without any email/invite infrastructure to hand it to the actual
 * person would mean either logging a real credential or inventing one nobody can use — a Keycloak
 * account created this way needs its password set separately (console, admin API call, or a future
 * invite flow) before it can complete a password-based login.
 */
@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);
  private readonly config: KeycloakAdminConfiguration;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService,
  ) {
    this.config = configService.get<KeycloakAdminConfiguration>('KEYCLOAK_ADMIN_CONFIG', { infer: true });
  }

  /**
   * Creates the Keycloak identity for an app user. Returns the new Keycloak user's id — Keycloak's
   * create-user endpoint returns 201 with no body, only a Location header, which is where that id
   * actually comes from.
   */
  async createUser(input: CreateKeycloakUserInput): Promise<string> {
    const token = await this.getAdminToken();

    try {
      const { headers } = await firstValueFrom(
        this.httpService.post<void>(
          `${this.config.adminApiBaseUrl}/users`,
          {
            username: input.username,
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            enabled: true,
            emailVerified: false,
            requiredActions: ['UPDATE_PASSWORD'],
          },
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );

      const location = headers['location'] as string | undefined;
      const keycloakUserId = location?.split('/').pop();

      if (!keycloakUserId) {
        throw new InternalServerErrorException('Keycloak did not return a user id for the created user.');
      }

      return keycloakUserId;
    } catch (error) {
      this.logger.error(
        `Failed to create Keycloak user for username="${input.username}"`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('Failed to provision the identity for this user.');
    }
  }

  async assignRealmRole(keycloakUserId: string, roleName: string): Promise<void> {
    const token = await this.getAdminToken();

    try {
      const { data: role } = await firstValueFrom(
        this.httpService.get<KeycloakRoleRepresentation>(`${this.config.adminApiBaseUrl}/roles/${roleName}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );

      await firstValueFrom(
        this.httpService.post<void>(
          `${this.config.adminApiBaseUrl}/users/${keycloakUserId}/role-mappings/realm`,
          [role],
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to assign realm role "${roleName}" to Keycloak user "${keycloakUserId}"`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('Failed to assign a role to this user.');
    }
  }

  /**
   * `POST .../role-mappings/realm` only adds a mapping — it doesn't replace whatever role a user
   * already has. Reassigning a user's role in user-access (PATCH /users/:id changing roleId) has
   * to remove the old realm role explicitly, or the user ends up with both roles simultaneously,
   * and getPermissionsForRoles() takes the union of both, granting more than the new role alone.
   */
  async removeRealmRole(keycloakUserId: string, roleName: string): Promise<void> {
    const token = await this.getAdminToken();

    try {
      const { data: role } = await firstValueFrom(
        this.httpService.get<KeycloakRoleRepresentation>(`${this.config.adminApiBaseUrl}/roles/${roleName}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );

      await firstValueFrom(
        this.httpService.delete<void>(`${this.config.adminApiBaseUrl}/users/${keycloakUserId}/role-mappings/realm`, {
          headers: { Authorization: `Bearer ${token}` },
          data: [role],
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to remove realm role "${roleName}" from Keycloak user "${keycloakUserId}"`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('Failed to update this user’s role.');
    }
  }

  /**
   * Disables (or re-enables) the Keycloak account — used when a user is deactivated in
   * user-access, so no *new* token can be issued for them. Deliberately not a full revocation:
   * an access token already issued before this call remains valid for its own remaining lifetime
   * (a few minutes at most) since JWT verification never re-checks Keycloak per request. Real-time
   * revocation of already-issued tokens is a separate, larger piece of work, not attempted here.
   */
  async setEnabled(keycloakUserId: string, enabled: boolean): Promise<void> {
    const token = await this.getAdminToken();

    try {
      await firstValueFrom(
        this.httpService.put<void>(
          `${this.config.adminApiBaseUrl}/users/${keycloakUserId}`,
          { enabled },
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to set enabled=${enabled} on Keycloak user "${keycloakUserId}"`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('Failed to update this user’s account status.');
    }
  }

  /**
   * Rollback helper — used when Keycloak user creation succeeds but a later step (role
   * assignment, the local Postgres write) fails, to avoid leaving an orphaned Keycloak identity
   * with no corresponding user-access record. Deliberately swallows its own failure (logged, not
   * thrown) since it's already running from inside a catch block — an error here shouldn't mask
   * the original failure that triggered the rollback.
   */
  async deleteUser(keycloakUserId: string): Promise<void> {
    const token = await this.getAdminToken();

    try {
      await firstValueFrom(
        this.httpService.delete<void>(`${this.config.adminApiBaseUrl}/users/${keycloakUserId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to roll back orphaned Keycloak user "${keycloakUserId}" — it will need manual cleanup`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async getAdminToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.token;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.ADMIN_CLIENT_ID,
      client_secret: this.config.ADMIN_CLIENT_SECRET,
    });

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<KeycloakAdminTokenResponse>(this.config.tokenUrl, body.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );

      this.cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS) * 1000,
      };

      return this.cachedToken.token;
    } catch (error) {
      const detail = isAxiosError(error) ? error.response?.data : error;
      this.logger.error('Failed to obtain a Keycloak admin token', JSON.stringify(detail));
      throw new InternalServerErrorException('Failed to authenticate with the identity provider.');
    }
  }
}
