import { readdirSync } from 'fs';
import { join } from 'path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource, QueryFailedError, type MigrationInterface } from 'typeorm';
import { runWithCorrelationContext } from '@libs/logging/correlation-context';
import { UserRepository } from '../app/modules/user/user.repository';
import { MembershipDirectory } from '../app/modules/membership/membership-directory';
import { MembershipEntity } from './entities/membership.entity';
import { OrganizationEntity } from './entities/organization.entity';
import { RoleEntity } from './entities/role.entity';
import { UserEntity } from './entities/user.entity';

// Every migration file in the directory, exactly what `user-access:migration:run` would apply —
// listed from disk so a new migration is picked up without editing this spec.
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.ts'))
  .sort()
  .flatMap((file) => Object.values(require(join(MIGRATIONS_DIR, file)) as Record<string, unknown>))
  .filter((exported): exported is new () => MigrationInterface => typeof exported === 'function');

const ENTITIES = [RoleEntity, UserEntity, OrganizationEntity, MembershipEntity];
const DEFAULT_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Integration test: user-access's migrations, the tenant-scoped UserRepository and the
 * cross-tenant MembershipDirectory against a real Postgres. What a mock can't show: that the
 * migrations build the entities' schema *and keep existing roles*, that constraints are real, and
 * that one organization can never see or change another's members.
 */
describe('user-access database (real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let members: UserRepository;
  let directory: MembershipDirectory;
  let accountant: RoleEntity;
  let admin: RoleEntity;
  let acme: OrganizationEntity;
  let globex: OrganizationEntity;

  // A fresh database per migration test, so migrations can be applied (and data written) one at a time.
  async function freshDataSource(name: string, applied: Array<new () => MigrationInterface> = migrations) {
    const adminConnection = new DataSource({ type: 'postgres', url: container.getConnectionUri() });
    await adminConnection.initialize();
    await adminConnection.query(`CREATE DATABASE "${name}"`);
    await adminConnection.destroy();

    const url = new URL(container.getConnectionUri());
    url.pathname = `/${name}`;
    const fresh = new DataSource({ type: 'postgres', url: url.toString(), entities: ENTITIES, migrations: applied });
    await fresh.initialize();
    return fresh;
  }

  const inOrganization = <T>(organizationId: string, work: () => Promise<T>) =>
    runWithCorrelationContext({ correlationId: 'int', traceId: 'int', organizationId }, work);

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: ENTITIES,
      migrations,
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    const roles = dataSource.getRepository(RoleEntity);
    [accountant, admin] = await roles.save([
      roles.create({ name: 'accountant', permissions: ['invoice:read', 'invoice:write'] }),
      roles.create({ name: 'admin', permissions: ['user:read', 'user:write'] }),
    ]);
    const organizations = dataSource.getRepository(OrganizationEntity);
    [acme, globex] = await organizations.save([
      organizations.create({ name: 'Acme', slug: 'acme' }),
      organizations.create({ name: 'Globex', slug: 'globex' }),
    ]);
    members = new UserRepository(dataSource);
    directory = new MembershipDirectory(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await container?.stop();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM "memberships"`);
    await dataSource.query(`DELETE FROM "users"`);
  });

  let counter = 0;
  const person = (overrides: Partial<{ email: string; name: string; keycloakUserId: string }> = {}) => ({
    email: `user-${++counter}@acme.test`,
    name: 'Test User',
    keycloakUserId: `kc-${counter}`,
    ...overrides,
  });

  describe('migrations', () => {
    it('produce exactly the schema the entities describe (no drift)', async () => {
      const pending = await dataSource.driver.createSchemaBuilder().log();

      expect(pending.upQueries.map((query) => query.query)).toEqual([]);
    });

    // The generated migration dropped users.roleId before anything copied it -- every user would
    // have lost their role. Written *between* migrations, as a production database would be.
    it('moves every existing user, with their role and active flag, into the default organization', async () => {
      const before = migrations.filter((m) => !m.name.startsWith('AddOrganizationsAndMemberships'));
      const AddTenancy = migrations.find((m) => m.name.startsWith('AddOrganizationsAndMemberships'));
      if (!AddTenancy) throw new Error('tenancy migration not found');
      const db = await freshDataSource('tenancy_data', []);
      const runner = db.createQueryRunner();
      try {
        for (const Migration of before) await new Migration().up(runner);
        const [role] = await db.query(`INSERT INTO roles (name) VALUES ('viewer') RETURNING id`);
        await db.query(
          `INSERT INTO users (email, name, "roleId", "isActive", "keycloakUserId") VALUES
             ('ann@x.test', 'Ann', $1, true, 'kc-ann'), ('bob@x.test', 'Bob', $1, false, NULL)`,
          [role.id],
        );

        await new AddTenancy().up(runner);

        const rows = await db.query(
          `SELECT u.email, m."organizationId", m."roleId", m."isActive" FROM memberships m
           JOIN users u ON u.id = m."userId" ORDER BY u.email`,
        );
        expect(rows).toEqual([
          { email: 'ann@x.test', organizationId: DEFAULT_ORGANIZATION_ID, roleId: role.id, isActive: true },
          { email: 'bob@x.test', organizationId: DEFAULT_ORGANIZATION_ID, roleId: role.id, isActive: false },
        ]);

        // And back: the revert restores users.roleId from the memberships.
        await new AddTenancy().down(runner);
        expect(await db.query(`SELECT email, "roleId" FROM users ORDER BY email`)).toEqual([
          { email: 'ann@x.test', roleId: role.id },
          { email: 'bob@x.test', roleId: role.id },
        ]);
      } finally {
        await runner.release();
        await db.destroy();
      }
    });

    it('refuses to add tenancy while two users claim the same Keycloak identity', async () => {
      const before = migrations.filter((m) => !m.name.startsWith('AddOrganizationsAndMemberships'));
      const AddTenancy = migrations.find((m) => m.name.startsWith('AddOrganizationsAndMemberships'));
      if (!AddTenancy) throw new Error('tenancy migration not found');
      const db = await freshDataSource('tenancy_dupes', []);
      const runner = db.createQueryRunner();
      try {
        for (const Migration of before) await new Migration().up(runner);
        const [role] = await db.query(`INSERT INTO roles (name) VALUES ('viewer') RETURNING id`);
        await db.query(
          `INSERT INTO users (email, name, "roleId", "keycloakUserId") VALUES ('a@x.test', 'A', $1, 'kc-dup'), ('b@x.test', 'B', $1, 'kc-dup')`,
          [role.id],
        );

        await expect(new AddTenancy().up(runner)).rejects.toThrow(/linked to more than one user: kc-dup/);
      } finally {
        await runner.release();
        await db.destroy();
      }
    });
  });

  describe('constraints', () => {
    it('allows one membership per person per organization', async () => {
      const membership = await directory.createPersonWithMembership(person(), acme.id, accountant.id);

      await expect(directory.addMembership(membership.userId, acme.id, admin.id)).rejects.toMatchObject({
        driverError: expect.objectContaining({ code: '23505' }),
      });
      await expect(directory.addMembership(membership.userId, globex.id, admin.id)).resolves.toBeDefined();
    });

    it('rejects a second person with the same Keycloak identity', async () => {
      await directory.createPersonWithMembership(person({ keycloakUserId: 'kc-same' }), acme.id, accountant.id);

      await expect(
        directory.createPersonWithMembership(person({ keycloakUserId: 'kc-same' }), acme.id, accountant.id),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('refuses to delete an organization that has members, and removes memberships with their person', async () => {
      const membership = await directory.createPersonWithMembership(person(), globex.id, accountant.id);

      await expect(dataSource.getRepository(OrganizationEntity).delete({ id: globex.id })).rejects.toBeInstanceOf(
        QueryFailedError,
      );
      await dataSource.getRepository(UserEntity).delete({ id: membership.userId });
      expect(await dataSource.getRepository(MembershipEntity).count({ where: { userId: membership.userId } })).toBe(0);
    });

    it('creates the person and their membership atomically', async () => {
      // An organization that doesn't exist fails the membership insert; the person must not remain.
      await expect(
        directory.createPersonWithMembership(
          person({ email: 'ghost@x.test' }),
          '11111111-1111-4111-8111-111111111111',
          admin.id,
        ),
      ).rejects.toBeInstanceOf(QueryFailedError);

      expect(await directory.findPersonByEmail('ghost@x.test')).toBeNull();
    });
  });

  // The point of the phase: one organization can never read or change another's members.
  describe('tenant isolation (UserRepository)', () => {
    let shared: MembershipEntity;
    let globexOnly: MembershipEntity;

    beforeEach(async () => {
      // One person in both organizations, with a different role in each.
      shared = await directory.createPersonWithMembership(person({ name: 'Sam Shared' }), acme.id, accountant.id);
      await directory.addMembership(shared.userId, globex.id, admin.id);
      globexOnly = await directory.createPersonWithMembership(
        person({ name: 'Gail Globex' }),
        globex.id,
        accountant.id,
      );
    });

    it('lists only the current organization’s members', async () => {
      const acmeList = await inOrganization(acme.id, () => members.findMembers({}));
      const globexList = await inOrganization(globex.id, () => members.findMembers({}));

      expect(acmeList.items.map((m) => m.user?.name)).toEqual(['Sam Shared']);
      expect(globexList.items.map((m) => m.user?.name).sort()).toEqual(['Gail Globex', 'Sam Shared']);
      expect(acmeList.total).toBe(1);
    });

    it('shows each organization its own role for the same person', async () => {
      expect((await inOrganization(acme.id, () => members.findMember(shared.userId)))?.role.name).toBe('accountant');
      expect((await inOrganization(globex.id, () => members.findMember(shared.userId)))?.role.name).toBe('admin');
    });

    it('treats a member of another organization as not found, for reads and writes', async () => {
      await expect(inOrganization(acme.id, () => members.findMember(globexOnly.userId))).resolves.toBeNull();
      await expect(
        inOrganization(acme.id, () => members.updateMember(globexOnly.userId, { isActive: false, roleId: admin.id })),
      ).resolves.toBeNull();

      const untouched = await inOrganization(globex.id, () => members.findMember(globexOnly.userId));
      expect(untouched).toMatchObject({ isActive: true, roleId: accountant.id });
    });

    it('changes the role and active flag in one organization only; the name is the person’s', async () => {
      await inOrganization(acme.id, () =>
        members.updateMember(shared.userId, { roleId: admin.id, isActive: false, name: 'Sam S.' }),
      );

      const inAcme = await inOrganization(acme.id, () => members.findMember(shared.userId));
      const inGlobex = await inOrganization(globex.id, () => members.findMember(shared.userId));
      expect(inAcme).toMatchObject({ roleId: admin.id, isActive: false });
      expect(inGlobex).toMatchObject({ roleId: admin.id, isActive: true });
      expect([inAcme?.user?.name, inGlobex?.user?.name]).toEqual(['Sam S.', 'Sam S.']);
    });

    it('filters by role and searches name/email within the organization only', async () => {
      const result = await inOrganization(globex.id, () =>
        members.findMembers({ roleId: accountant.id, search: 'gail' }),
      );

      expect(result.items.map((m) => m.user?.name)).toEqual(['Gail Globex']);
    });

    it('refuses to query at all without an organization in context', async () => {
      await expect(members.findMembers({})).rejects.toThrow(/No organization in the request context/);
    });
  });

  describe('membership resolution (MembershipDirectory)', () => {
    it('returns only active memberships of an active person in active organizations, oldest first', async () => {
      const first = await directory.createPersonWithMembership(
        person({ keycloakUserId: 'kc-resolve' }),
        acme.id,
        accountant.id,
      );
      await directory.addMembership(first.userId, globex.id, admin.id);

      expect((await directory.findActiveMembershipsOf('kc-resolve')).map((m) => m.organization.slug)).toEqual([
        'acme',
        'globex',
      ]);

      await inOrganization(acme.id, () => members.updateMember(first.userId, { isActive: false }));
      expect((await directory.findActiveMembershipsOf('kc-resolve')).map((m) => m.organization.slug)).toEqual([
        'globex',
      ]);

      await dataSource.getRepository(OrganizationEntity).update({ id: globex.id }, { isActive: false });
      try {
        expect(await directory.findActiveMembershipsOf('kc-resolve')).toEqual([]);
      } finally {
        await dataSource.getRepository(OrganizationEntity).update({ id: globex.id }, { isActive: true });
      }

      await dataSource.getRepository(UserEntity).update({ id: first.userId }, { isActive: false });
      expect(await directory.findActiveMembershipsOf('kc-resolve')).toEqual([]);
    });

    it('finds a person by email case-insensitively', async () => {
      await directory.createPersonWithMembership(person({ email: 'Mixed.Case@Acme.test' }), acme.id, accountant.id);

      expect((await directory.findPersonByEmail('mixed.case@acme.test'))?.email).toBe('mixed.case@acme.test');
    });
  });
});
