import { IsNotEmpty, IsString } from 'class-validator';

export class KeycloakConfiguration {
  @IsString()
  @IsNotEmpty()
  BASE_URL: string;

  // Server-to-server calls (token exchange, JWKS fetch) use BASE_URL, which in Docker is the
  // internal service hostname (e.g. http://keycloak:8080) — unreachable from a real browser. The
  // authorization redirect the browser follows needs a publicly reachable address instead; this
  // defaults to BASE_URL so a deployment where they're genuinely the same doesn't need to set it.
  @IsString()
  @IsNotEmpty()
  PUBLIC_BASE_URL: string;

  @IsString()
  @IsNotEmpty()
  REALM: string;

  @IsString()
  @IsNotEmpty()
  CLIENT_ID: string;

  @IsString()
  @IsNotEmpty()
  CLIENT_SECRET: string;

  // Must exactly match what's registered on the Keycloak client and be sent identically in both
  // the initial authorization request and the subsequent token exchange.
  @IsString()
  @IsNotEmpty()
  REDIRECT_URI: string;

  constructor() {
    this.BASE_URL = process.env['KEYCLOAK_BASE_URL'] ?? '';
    this.PUBLIC_BASE_URL = process.env['KEYCLOAK_PUBLIC_BASE_URL'] ?? this.BASE_URL;
    this.REALM = process.env['KEYCLOAK_REALM'] ?? '';
    this.CLIENT_ID = process.env['KEYCLOAK_CLIENT_ID'] ?? '';
    this.CLIENT_SECRET = process.env['KEYCLOAK_CLIENT_SECRET'] ?? '';
    this.REDIRECT_URI = process.env['KEYCLOAK_REDIRECT_URI'] ?? '';
  }

  get issuerUrl(): string {
    return `${this.BASE_URL}/realms/${this.REALM}`;
  }

  get jwksUri(): string {
    return `${this.issuerUrl}/protocol/openid-connect/certs`;
  }

  get tokenUrl(): string {
    return `${this.issuerUrl}/protocol/openid-connect/token`;
  }

  get logoutUrl(): string {
    return `${this.issuerUrl}/protocol/openid-connect/logout`;
  }

  get publicAuthorizationUrl(): string {
    return `${this.PUBLIC_BASE_URL}/realms/${this.REALM}/protocol/openid-connect/auth`;
  }
}
