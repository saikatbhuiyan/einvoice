import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { JwksClient } from 'jwks-rsa';
import { KeycloakConfiguration } from './auth.config';

const CACHE_KEY_PREFIX = 'keycloak:jwks:key';
// How long a signing key stays usable as a fallback once Keycloak is confirmed unreachable. This
// is a deliberate trade-off, not just a resilience knob: a longer window survives a longer outage,
// but also means a key Keycloak has legitimately rotated away from (e.g. after a compromise) stays
// trusted here for longer during that same outage. An hour comfortably covers a restart or a
// network blip without leaving a rotated key trusted for an extended period.
const FALLBACK_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Wraps jwks-rsa's own JWKS client (which already does a short-lived in-memory cache) with a
 * Redis-backed fallback. jwks-rsa's cache alone doesn't help a freshly started `bff` instance if
 * Keycloak happens to be unreachable at that exact moment — there's nothing in memory yet. This
 * persists every successfully resolved key to Redis, and on a live fetch failure, falls back to
 * the last known-good key for that `kid` if one is cached, rather than rejecting every request
 * until Keycloak recovers.
 */
@Injectable()
export class JwksCacheService {
  private readonly logger = new Logger(JwksCacheService.name);
  private readonly client: JwksClient;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    configService: ConfigService,
  ) {
    const config = configService.get<KeycloakConfiguration>('KEYCLOAK_CONFIG', { infer: true });
    this.client = new JwksClient({
      jwksUri: config.jwksUri,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
    });
  }

  async getSigningKey(kid: string): Promise<string> {
    const cacheKey = `${CACHE_KEY_PREFIX}:${kid}`;

    try {
      const key = await this.client.getSigningKey(kid);
      const publicKey = key.getPublicKey();

      // Best-effort durable backup — a failed write here shouldn't fail a verification that just
      // succeeded against a live JWKS fetch.
      this.cacheManager.set(cacheKey, publicKey, FALLBACK_CACHE_TTL_MS).catch(() => {
        this.logger.warn(`Failed to persist fallback JWKS cache entry for kid="${kid}"`);
      });

      return publicKey;
    } catch (error) {
      const cached = await this.cacheManager.get<string>(cacheKey).catch(() => undefined);

      if (cached) {
        this.logger.warn(
          `Keycloak JWKS endpoint unreachable — verifying against the last known-good key for kid="${kid}" from Redis.`,
        );
        return cached;
      }

      throw error;
    }
  }
}
