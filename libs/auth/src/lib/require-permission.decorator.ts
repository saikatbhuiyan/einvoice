import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';

/** Requires the authenticated user's resolved permissions to include every permission listed. Evaluated by PermissionGuard, which runs after JwtAuthGuard. */
export const RequirePermission = (...permissions: string[]) => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
