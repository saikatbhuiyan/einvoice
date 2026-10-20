/**
 * The organization every pre-tenancy record was moved into (user-access, product and payment
 * migrations; invoice's backfill script). Fixed so all of them agree without looking it up.
 */
export const DEFAULT_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

/** Request header selecting the active organization, for callers who belong to more than one. */
export const ORGANIZATION_HEADER = 'x-organization-id';

/**
 * `platform:*` permissions act across organizations (e.g. creating one) and come from platform
 * realm roles; every other permission is granted by a membership and only means something inside
 * the caller's active organization.
 */
export const PLATFORM_PERMISSION_PREFIX = 'platform:';

export function isPlatformPermission(permission: string): boolean {
  return permission.startsWith(PLATFORM_PERMISSION_PREFIX);
}
