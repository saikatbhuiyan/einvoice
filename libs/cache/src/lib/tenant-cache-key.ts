import { requireOrganizationId } from '@libs/logging/correlation-context';

/**
 * A cache key for tenant-owned data: `<namespace>:org:<organizationId>:<parts...>`, with the
 * organization taken from the request context. Throws without one -- a tenant cache entry built
 * without an organization could be served to every tenant. List-version counters built with it are
 * per organization too, so one tenant's write invalidates only its own lists.
 */
export function tenantCacheKey(namespace: string, ...parts: Array<string | number>): string {
  return [namespace, 'org', requireOrganizationId(), ...parts].join(':');
}
