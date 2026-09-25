import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { KeycloakConfiguration } from './auth.config';
import { JwksCacheService } from './jwks-cache.service';
import type { AuthenticatedUser } from './authenticated-user.interface';

interface KeycloakJwtPayload {
  sub: string;
  preferred_username?: string;
  email?: string;
  realm_access?: { roles?: string[] };
}

// A JWT's header ("kid", "alg", ...) is base64url and unsigned — reading it is not the same as
// verifying the token, it's only how we know which JWKS key to verify the signature against next.
function decodeJwtKeyId(token: string): string | undefined {
  const [headerSegment] = token.split('.');
  if (!headerSegment) return undefined;

  try {
    const header = JSON.parse(Buffer.from(headerSegment, 'base64url').toString('utf8')) as { kid?: string };
    return header.kid;
  } catch {
    return undefined;
  }
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly jwksCache: JwksCacheService,
  ) {
    const config = configService.get<KeycloakConfiguration>('KEYCLOAK_CONFIG', { infer: true });

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer: config.issuerUrl,
      algorithms: ['RS256'],
      secretOrKeyProvider: (
        _request: unknown,
        rawJwtToken: string,
        done: (err: Error | null, key?: string) => void,
      ) => {
        const kid = decodeJwtKeyId(rawJwtToken);

        if (!kid) {
          done(new Error('JWT is missing a "kid" header — cannot resolve a signing key.'));
          return;
        }

        this.jwksCache
          .getSigningKey(kid)
          .then((key) => done(null, key))
          .catch((error: unknown) => done(error instanceof Error ? error : new Error(String(error))));
      },
    });
  }

  validate(payload: KeycloakJwtPayload): AuthenticatedUser {
    return {
      sub: payload.sub,
      username: payload.preferred_username ?? payload.sub,
      email: payload.email,
      roles: payload.realm_access?.roles ?? [],
    };
  }
}
