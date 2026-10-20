import AppDataSource from '../data-source';
import { MembershipEntity } from '../entities/membership.entity';
import { RoleEntity } from '../entities/role.entity';
import { UserEntity } from '../entities/user.entity';

/**
 * DEV ONLY (refuses NODE_ENV=production). Makes the dev realm's test users (infra/keycloak/
 * realm-export) members of the default organization, so logging in as one of them works locally:
 * permissions come from memberships, and a Keycloak user with none belongs nowhere.
 *
 * Idempotent: looks each username up in Keycloak (their ids are generated at realm import, so they
 * differ per machine), then upserts the local user and the membership.
 *
 *   nx run user-access:seed-dev-memberships   (after migrations and seed-roles, with Keycloak up)
 *
 * dev.platform gets no membership: platform-admin is a realm role, and it belongs to no organization.
 */
const DEFAULT_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const DEV_MEMBERS: ReadonlyArray<{ username: string; role: string }> = [
  { username: 'dev.admin', role: 'admin' },
  { username: 'dev.accountant', role: 'accountant' },
];

interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

async function adminToken(baseUrl: string, realm: string): Promise<string> {
  const response = await fetch(`${baseUrl}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env('KEYCLOAK_ADMIN_CLIENT_ID'),
      client_secret: env('KEYCLOAK_ADMIN_CLIENT_SECRET'),
    }),
  });
  if (!response.ok) throw new Error(`Keycloak token request failed: HTTP ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function findKeycloakUser(
  baseUrl: string,
  realm: string,
  token: string,
  username: string,
): Promise<KeycloakUser> {
  const response = await fetch(
    `${baseUrl}/admin/realms/${realm}/users?exact=true&username=${encodeURIComponent(username)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Keycloak user lookup for "${username}" failed: HTTP ${response.status}`);
  const [user] = (await response.json()) as KeycloakUser[];
  if (!user) throw new Error(`"${username}" is not in realm "${realm}" -- re-import the dev realm (see CLAUDE.md).`);
  return user;
}

async function seed(): Promise<void> {
  if ((process.env['NODE_ENV'] ?? 'development') === 'production') {
    throw new Error('seed-dev-memberships is for development only.');
  }
  // data-source.ts has already loaded .env/.env.dev.
  const baseUrl = env('KEYCLOAK_BASE_URL');
  const realm = env('KEYCLOAK_REALM');
  const token = await adminToken(baseUrl, realm);

  await AppDataSource.initialize();
  try {
    await AppDataSource.transaction(async (manager) => {
      for (const { username, role: roleName } of DEV_MEMBERS) {
        const keycloakUser = await findKeycloakUser(baseUrl, realm, token, username);
        const role = await manager.findOneByOrFail(RoleEntity, { name: roleName });

        await manager.upsert(
          UserEntity,
          {
            keycloakUserId: keycloakUser.id,
            email: (keycloakUser.email ?? `${username}@einvoice.local`).toLowerCase(),
            name: [keycloakUser.firstName, keycloakUser.lastName].filter(Boolean).join(' ') || username,
            isActive: true,
          },
          ['email'],
        );
        const user = await manager.findOneByOrFail(UserEntity, { keycloakUserId: keycloakUser.id });

        await manager.upsert(
          MembershipEntity,
          { userId: user.id, organizationId: DEFAULT_ORGANIZATION_ID, roleId: role.id, isActive: true },
          ['userId', 'organizationId'],
        );
        console.log(`${username} -> ${roleName} in the default organization`);
      }
    });
  } finally {
    await AppDataSource.destroy();
  }
}

seed().catch((error: unknown) => {
  console.error('Failed to seed dev memberships:', error);
  process.exit(1);
});
