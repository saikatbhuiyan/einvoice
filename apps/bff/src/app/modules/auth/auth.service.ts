import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { KeycloakConfiguration } from '@libs/auth';
import { LoginDto, LoginResponseDto } from './dto/login.dto';

interface KeycloakTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface KeycloakErrorResponse {
  error: string;
  error_description?: string;
}

// Keycloak's own token-endpoint error codes for a bad login attempt — confirmed against a live
// realm: wrong password / disabled account come back as HTTP 401 with error "invalid_grant";
// malformed requests (missing fields, unknown client) come back as HTTP 400 with "invalid_request"
// or "unauthorized_client". Checking the OAuth error code rather than the HTTP status is what
// actually distinguishes "bad credentials" from "something is broken" here — Keycloak doesn't use
// the status code consistently enough on its own to tell the two apart.
const CREDENTIAL_ERROR_CODES = new Set(['invalid_grant']);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly keycloakConfig: KeycloakConfiguration;

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService,
  ) {
    this.keycloakConfig = configService.get<KeycloakConfiguration>('KEYCLOAK_CONFIG', { infer: true });
  }

  async login({ username, password }: LoginDto): Promise<LoginResponseDto> {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: this.keycloakConfig.CLIENT_ID,
      client_secret: this.keycloakConfig.CLIENT_SECRET,
      username,
      password,
    });

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<KeycloakTokenResponse>(this.keycloakConfig.tokenUrl, body.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        tokenType: data.token_type,
      };
    } catch (error) {
      // `instanceof AxiosError` is unreliable here — webpack bundling this module separately from
      // @nestjs/axios's own copy of the axios package means the thrown error and the imported
      // AxiosError class can be two different class instances even though both are "real" axios
      // errors. `isAxiosError` is the duck-typed property axios itself sets for exactly this
      // reason (multiple bundled/nested copies of the package are a known axios+bundler scenario),
      // so check that instead of relying on class identity.
      const keycloakError = isAxiosError<KeycloakErrorResponse>(error) ? error.response?.data?.error : undefined;

      if (keycloakError && CREDENTIAL_ERROR_CODES.has(keycloakError)) {
        throw new UnauthorizedException('Invalid username or password.');
      }

      // Anything else (network failure, 5xx, misconfigured client, an unrecognized error code) is
      // a real operational problem, not a routine bad login attempt — logged distinctly rather
      // than silently folded into the same client-facing message.
      this.logger.error('Keycloak login request failed', error instanceof Error ? error.stack : String(error));
      throw new UnauthorizedException('Unable to authenticate at this time.');
    }
  }
}
