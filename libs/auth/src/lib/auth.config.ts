import { IsNotEmpty, IsString } from 'class-validator';

export class KeycloakConfiguration {
  @IsString()
  @IsNotEmpty()
  BASE_URL: string;

  @IsString()
  @IsNotEmpty()
  REALM: string;

  @IsString()
  @IsNotEmpty()
  CLIENT_ID: string;

  @IsString()
  @IsNotEmpty()
  CLIENT_SECRET: string;

  constructor() {
    this.BASE_URL = process.env['KEYCLOAK_BASE_URL'] ?? '';
    this.REALM = process.env['KEYCLOAK_REALM'] ?? '';
    this.CLIENT_ID = process.env['KEYCLOAK_CLIENT_ID'] ?? '';
    this.CLIENT_SECRET = process.env['KEYCLOAK_CLIENT_SECRET'] ?? '';
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
}
