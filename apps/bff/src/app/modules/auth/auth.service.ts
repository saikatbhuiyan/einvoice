import { randomUUID } from 'crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import type { Cache } from 'cache-manager';
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
// realm: wrong password / disabled account / an expired or already-used authorization code come
// back as HTTP 401 with error "invalid_grant"; malformed requests (missing fields, unknown client)
// come back as HTTP 400 with "invalid_request" or "unauthorized_client". Checking the OAuth error
// code rather than the HTTP status is what actually distinguishes "bad credentials" from
// "something is broken" here — Keycloak doesn't use the status code consistently enough on its own
// to tell the two apart.
const CREDENTIAL_ERROR_CODES = new Set(['invalid_grant']);

// One-time login state, keyed in Redis rather than a signed cookie — this app has no session
// cookie infrastructure yet (bff is a pure JSON API), and Redis is already the shared short-TTL
// store every other part of this codebase uses (rate limiting, the JWKS fallback cache).
const STATE_CACHE_PREFIX = 'auth:state';
const STATE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly keycloakConfig: KeycloakConfiguration;

  constructor(
    private readonly httpService: HttpService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    configService: ConfigService,
  ) {
    this.keycloakConfig = configService.get<KeycloakConfiguration>('KEYCLOAK_CONFIG', { infer: true });
  }

  async login({ username, password }: LoginDto): Promise<LoginResponseDto> {
    return this.exchangeForToken(
      new URLSearchParams({
        grant_type: 'password',
        client_id: this.keycloakConfig.CLIENT_ID,
        client_secret: this.keycloakConfig.CLIENT_SECRET,
        username,
        password,
      }),
      'Invalid username or password.',
    );
  }

  /**
   * Builds the URL to send a browser to for the Authorization Code flow — the only flow that
   * works for a federated identity provider like Google, which has no equivalent of "hand me your
   * password directly" the way the Resource Owner Password grant `login()` uses. Uses
   * `publicAuthorizationUrl`, not `issuerUrl` — this URL is followed by a real browser, which
   * (unlike bff itself) can't resolve Keycloak's internal Docker hostname.
   */
  async buildAuthorizationUrl(): Promise<string> {
    const state = randomUUID();

    try {
      await this.cacheManager.set(`${STATE_CACHE_PREFIX}:${state}`, true, STATE_TTL_MS);
    } catch {
      this.logger.warn('Failed to persist login state — callback will be rejected as invalid.');
    }

    const params = new URLSearchParams({
      client_id: this.keycloakConfig.CLIENT_ID,
      redirect_uri: this.keycloakConfig.REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });

    return `${this.keycloakConfig.publicAuthorizationUrl}?${params.toString()}`;
  }

  /**
   * Exchanges the authorization code Keycloak redirected back with for a token. `state` must
   * match one `buildAuthorizationUrl()` issued and not yet consumed — checked and deleted here
   * (one-time use) as the CSRF protection standard for this flow: without it, an attacker could
   * trick a victim's browser into completing a login the attacker initiated.
   */
  async handleCallback(code: string | undefined, state: string | undefined): Promise<LoginResponseDto> {
    if (!code || !state) {
      throw new UnauthorizedException(
        'Missing authorization code or state — the login attempt may have been cancelled.',
      );
    }

    const stateKey = `${STATE_CACHE_PREFIX}:${state}`;
    const validState = await this.cacheManager.get(stateKey).catch(() => undefined);

    if (!validState) {
      throw new UnauthorizedException('Invalid or expired login state.');
    }

    await this.cacheManager.del(stateKey).catch(() => {
      this.logger.warn(`Failed to delete consumed login state "${state}" — it will expire via TTL instead.`);
    });

    return this.exchangeForToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.keycloakConfig.CLIENT_ID,
        client_secret: this.keycloakConfig.CLIENT_SECRET,
        code,
        redirect_uri: this.keycloakConfig.REDIRECT_URI,
      }),
      'Invalid, expired, or already-used authorization code.',
    );
  }

  private async exchangeForToken(body: URLSearchParams, invalidGrantMessage: string): Promise<LoginResponseDto> {
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
        throw new UnauthorizedException(invalidGrantMessage);
      }

      // Anything else (network failure, 5xx, misconfigured client, an unrecognized error code) is
      // a real operational problem, not a routine bad login attempt — logged distinctly rather
      // than silently folded into the same client-facing message.
      this.logger.error('Keycloak token request failed', error instanceof Error ? error.stack : String(error));
      throw new UnauthorizedException('Unable to authenticate at this time.');
    }
  }
}
