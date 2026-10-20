import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { setIdentityOnCurrentContext } from '@libs/logging';
import { isPlatformPermission, ORGANIZATION_HEADER } from '@libs/shared/types';
import { REQUIRED_PERMISSIONS_KEY } from './require-permission.decorator';
import { PERMISSION_RESOLVER, type PermissionResolver } from './permission-resolver.interface';
import type { AuthenticatedUser } from './authenticated-user.interface';

interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

/**
 * Resolves, for every authenticated request, which organization it acts in and what the caller may
 * do there -- then enforces @RequirePermission. The organization comes from the X-Organization-Id
 * header, *validated against the caller's memberships* (never believed as-is), or is the caller's
 * only organization. It is put on the request context, so every downstream RPC carries it and every
 * downstream query is scoped to it.
 *
 * Resolution happens even for routes without @RequirePermission: downstream services enforce their
 * own permissions and scope their own queries, so they always need the caller's real context.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PERMISSION_RESOLVER) private readonly permissionResolver: PermissionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    // No authenticated user means JwtAuthGuard let this through as @Public(), which has nothing to
    // resolve or check here.
    if (!user) {
      return true;
    }

    const requested = this.requestedOrganization(request);
    const resolution = await this.permissionResolver.resolveCaller({ userId: user.sub, roles: user.roles }, requested);

    if (resolution.status === 'not_member') {
      throw new ForbiddenException(`You are not a member of organization "${requested}".`);
    }

    user.permissions = resolution.permissions;
    user.organizationId = resolution.organizationId;
    user.memberships = resolution.memberships;
    setIdentityOnCurrentContext({ permissions: resolution.permissions, organizationId: resolution.organizationId });

    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    // A tenant permission needs an organization to mean anything. Say *why* it's missing instead
    // of reporting the permission itself as missing.
    if (!resolution.organizationId && required.some((permission) => !isPlatformPermission(permission))) {
      if (resolution.status === 'ambiguous') {
        throw new BadRequestException(
          `You belong to several organizations; choose one with the ${ORGANIZATION_HEADER} header.`,
        );
      }
      throw new ForbiddenException('You are not a member of any organization.');
    }

    const missing = required.filter((permission) => !resolution.permissions.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}.`);
    }

    return true;
  }

  private requestedOrganization(request: Request): string | undefined {
    const header = request.headers[ORGANIZATION_HEADER];
    const value = (Array.isArray(header) ? header[0] : header)?.trim();
    return value || undefined;
  }
}
