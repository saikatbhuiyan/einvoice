import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as exempt from the global JwtAuthGuard (and therefore PermissionGuard, which never runs without an authenticated user). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
