import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Deliberately separate from KeycloakConfiguration (bff's browser-facing client config) rather
 * than reused — this models a different client entirely (einvoice-admin-cli, client-credentials
 * only, never used for end-user login) with a different secret and no notion of a redirect URI or
 * a public-facing URL, since nothing here is ever followed by a real browser.
 */
export class KeycloakAdminConfiguration {
  @IsString()
  @IsNotEmpty()
  BASE_URL: string;

  @IsString()
  @IsNotEmpty()
  REALM: string;

  @IsString()
  @IsNotEmpty()
  ADMIN_CLIENT_ID: string;

  @IsString()
  @IsNotEmpty()
  ADMIN_CLIENT_SECRET: string;

  constructor() {
    this.BASE_URL = process.env['KEYCLOAK_BASE_URL'] ?? '';
    this.REALM = process.env['KEYCLOAK_REALM'] ?? '';
    this.ADMIN_CLIENT_ID = process.env['KEYCLOAK_ADMIN_CLIENT_ID'] ?? '';
    this.ADMIN_CLIENT_SECRET = process.env['KEYCLOAK_ADMIN_CLIENT_SECRET'] ?? '';
  }

  get tokenUrl(): string {
    return `${this.BASE_URL}/realms/${this.REALM}/protocol/openid-connect/token`;
  }

  get adminApiBaseUrl(): string {
    return `${this.BASE_URL}/admin/realms/${this.REALM}`;
  }
}
