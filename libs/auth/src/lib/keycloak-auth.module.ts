import { DynamicModule, Global, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { HttpModule } from '@nestjs/axios';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Wires up JWT verification against Keycloak's JWKS endpoint. Does NOT provide PermissionGuard —
 * that guard needs a PERMISSION_RESOLVER implementation, which is app-specific (it has to reach
 * into that app's own role/permission data), so the consuming app declares PermissionGuard as a
 * provider in its own module alongside its PERMISSION_RESOLVER, per this repo's existing pattern
 * for dynamic-module provider resolution (see PostgresModule/MongoDbModule in CLAUDE.md).
 */
@Global()
@Module({})
export class KeycloakAuthModule {
  static forRoot(): DynamicModule {
    return {
      module: KeycloakAuthModule,
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), HttpModule],
      providers: [JwtStrategy, JwtAuthGuard],
      exports: [JwtAuthGuard, HttpModule],
    };
  }
}
