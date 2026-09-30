import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ClientsModule } from '@nestjs/microservices';
import { CacheModule } from '@libs/cache';
import { PERMISSION_RESOLVER, PermissionGuard } from '@libs/auth';
import { createGrpcClientConfig, GrpcServiceName } from '@libs/transports';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthorizerPermissionResolver } from './authorizer-permission.resolver';

/**
 * Declares PermissionGuard + PERMISSION_RESOLVER together, rather than relying on
 * KeycloakAuthModule (a @Global() lib module with no knowledge of Authorizer) to provide them —
 * same dynamic-module provider-resolution rule documented in CLAUDE.md for PostgresModule/
 * MongoDbModule: a provider is only resolvable from its own module's providers or the modules it
 * imports. PERMISSION_RESOLVER used to need UserModule (user-access over TCP); now it needs a
 * gRPC client to Authorizer instead — UserModule is gone from these imports because nothing here
 * uses UserService anymore.
 */
@Module({
  imports: [
    HttpModule,
    CacheModule.forRoot('bff'),
    ClientsModule.register([createGrpcClientConfig(GrpcServiceName.AUTHORIZER)]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PermissionGuard,
    AuthorizerPermissionResolver,
    { provide: PERMISSION_RESOLVER, useExisting: AuthorizerPermissionResolver },
  ],
  exports: [PermissionGuard],
})
export class AuthModule {}
