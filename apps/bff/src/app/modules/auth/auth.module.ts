import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PERMISSION_RESOLVER, PermissionGuard } from '@libs/auth';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserPermissionResolver } from './user-permission.resolver';

/**
 * Declares PermissionGuard + PERMISSION_RESOLVER together, rather than relying on
 * KeycloakAuthModule (a @Global() lib module with no knowledge of user-access) to provide them —
 * PERMISSION_RESOLVER's implementation needs UserService, which only this module's own imports
 * make resolvable (see the PostgresModule/MongoDbModule provider-resolution gotcha in CLAUDE.md;
 * the same rule applies here).
 */
@Module({
  imports: [UserModule, HttpModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PermissionGuard,
    UserPermissionResolver,
    { provide: PERMISSION_RESOLVER, useExisting: UserPermissionResolver },
  ],
  exports: [PermissionGuard],
})
export class AuthModule {}
