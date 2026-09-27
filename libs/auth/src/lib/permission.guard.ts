import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { setIdentityOnCurrentContext } from '@libs/logging';
import { REQUIRED_PERMISSIONS_KEY } from './require-permission.decorator';
import { PERMISSION_RESOLVER, type PermissionResolver } from './permission-resolver.interface';
import type { AuthenticatedUser } from './authenticated-user.interface';

interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PERMISSION_RESOLVER) private readonly permissionResolver: PermissionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    // @Public() routes never reach here with a user — JwtAuthGuard skipped verification entirely,
    // so there's no identity to resolve permissions for or enforce anything against.
    if (!user) {
      return true;
    }

    // Resolved for every authenticated request, not just ones @RequirePermission happens to gate,
    // so the permissions riding on the outgoing RpcEnvelope (via setIdentityOnCurrentContext) are
    // always populated for downstream services to check themselves — enforcement here stays
    // conditional on @RequirePermission, but propagation doesn't.
    const permissions = await this.permissionResolver.getPermissionsForRoles(user.roles);
    user.permissions = permissions;
    setIdentityOnCurrentContext({ permissions });

    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const missing = required.filter((permission) => !permissions.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}.`);
    }

    return true;
  }
}
