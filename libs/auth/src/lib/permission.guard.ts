import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
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
    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    // JwtAuthGuard runs first and always rejects an unauthenticated request before this guard
    // is reached, except on @Public() routes — which by definition never carry @RequirePermission.
    if (!user) {
      throw new ForbiddenException('Authenticated user is required to check permissions.');
    }

    const permissions = await this.permissionResolver.getPermissionsForRoles(user.roles);
    user.permissions = permissions;

    const missing = required.filter((permission) => !permissions.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}.`);
    }

    return true;
  }
}
