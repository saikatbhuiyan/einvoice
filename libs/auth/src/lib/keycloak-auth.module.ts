import { DynamicModule, Global, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@libs/cache';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwksCacheService } from './jwks-cache.service';

/**
 * Wires up JWT verification against Keycloak's JWKS endpoint. Does NOT provide PermissionGuard —
 * that guard needs a PERMISSION_RESOLVER implementation, which is app-specific (it has to reach
 * into that app's own role/permission data), so the consuming app declares PermissionGuard as a
 * provider in its own module alongside its PERMISSION_RESOLVER, per this repo's existing pattern
 * for dynamic-module provider resolution (see PostgresModule/MongoDbModule in CLAUDE.md).
 *
 * Imports its own CacheModule instance (rather than relying on the consuming app's own cache
 * module) so JwksCacheService's Redis-backed JWKS fallback works standalone — same rationale as
 * the AuditLogModule gotcha in CLAUDE.md: don't assume another module's registration reaches here.
 */
@Global()
@Module({})
export class KeycloakAuthModule {
  static forRoot(): DynamicModule {
    return {
      module: KeycloakAuthModule,
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), HttpModule, CacheModule.forRoot('bff')],
      providers: [JwtStrategy, JwtAuthGuard, JwksCacheService],
      exports: [JwtAuthGuard, HttpModule],
    };
  }
}
