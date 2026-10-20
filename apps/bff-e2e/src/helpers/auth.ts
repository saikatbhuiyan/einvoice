import { DEFAULT_ORGANIZATION_ID, ORGANIZATION_HEADER } from '@libs/shared/types';

// Seeded by infra/keycloak/realm-export/einvoice-realm.json (dev-only credentials), and made members
// of the default organization by `nx run user-access:seed-dev-memberships`.
export const DEV_USERS = {
  admin: { username: 'dev.admin', password: 'DevPassw0rd!' },
  accountant: { username: 'dev.accountant', password: 'DevPassw0rd!' },
} as const;

/** Token obtained once by global-setup.ts through bff's own /auth/login (which is rate limited). */
export async function tokenFor(user: keyof typeof DEV_USERS): Promise<string> {
  const token = process.env[`E2E_TOKEN_${user.toUpperCase()}`];
  if (!token) throw new Error(`no ${user} token — global-setup.ts did not log in`);
  return token;
}

/**
 * Every request names its organization, as a real client of a multi-organization user must: without
 * the header bff only picks one for a caller with exactly one membership, and the dev users may
 * belong to more (organizations created while trying the API locally).
 */
export const bearer = (token: string, organizationId: string = DEFAULT_ORGANIZATION_ID) => ({
  headers: { Authorization: `Bearer ${token}`, [ORGANIZATION_HEADER]: organizationId },
});
