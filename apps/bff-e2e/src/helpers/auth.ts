// Seeded by infra/keycloak/realm-export/einvoice-realm.json (dev-only credentials).
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

export const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
