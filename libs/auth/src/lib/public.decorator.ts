import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a handler as exempt from whichever global auth guard would otherwise apply to it:
 * `JwtAuthGuard` (and therefore `PermissionGuard`, which never runs without an authenticated user)
 * for HTTP routes, or `RpcPermissionGuard` for RPC handlers — both check this same metadata key.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
