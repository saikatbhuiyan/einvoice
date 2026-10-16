import { readdirSync } from 'fs';
import { join } from 'path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource, QueryFailedError } from 'typeorm';
import { UserRepository } from '../app/modules/user/user.repository';
import { RoleEntity } from './entities/role.entity';
import { UserEntity } from './entities/user.entity';

// Every migration file in the directory, exactly what `user-access:migration:run` would apply —
// listed from disk so a new migration is picked up without editing this spec.
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.ts'))
  .sort()
  .flatMap((file) => Object.values(require(join(MIGRATIONS_DIR, file)) as Record<string, unknown>))
  .filter((exported): exported is new () => object => typeof exported === 'function');

/**
 * Integration test: user-access's migrations and repository against a real Postgres. Covers what
 * a mocked repository cannot: that the migrations build the schema the entities describe, that
 * constraints are real, and the TypeORM eager-relation behavior documented in UserRepository.
 */
describe('user-access database (real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let users: UserRepository;
  let accountant: RoleEntity;
  let admin: RoleEntity;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [RoleEntity, UserEntity],
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
    users = new UserRepository(dataSource.getRepository(UserEntity));
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await container?.stop();
  });

  beforeEach(() => dataSource.getRepository(UserEntity).clear());

  const createUser = (overrides: Partial<{ email: string; name: string; roleId: string }> = {}) =>
    users.create({
      email: `user-${Math.random().toString(36).slice(2)}@acme.test`,
      name: 'Test User',
      roleId: accountant.id,
      keycloakUserId: 'kc-1',
      ...overrides,
    });

  describe('migrations', () => {
    it('apply cleanly to an empty database', async () => {
      const applied = await dataSource.query(`SELECT name FROM migrations ORDER BY id`);

      expect(applied).toHaveLength(migrations.length);
    });

    // The schema migrations build must be exactly what the entities describe. A non-empty diff
    // means someone changed an entity without generating a migration (or hand-edited one wrong).
    it('produce exactly the schema the entities describe (no drift)', async () => {
      const pending = await dataSource.driver.createSchemaBuilder().log();

      expect(pending.upQueries.map((query) => query.query)).toEqual([]);
    });

    it('revert cleanly, last to first', async () => {
      for (let i = 0; i < migrations.length; i++) await dataSource.undoLastMigration();
      const tables = await dataSource.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('users','roles')`,
      );
      expect(tables).toEqual([]);

      await dataSource.runMigrations();
      const roles = dataSource.getRepository(RoleEntity);
      [accountant, admin] = await roles.save([
        roles.create({ name: 'accountant', permissions: ['invoice:read', 'invoice:write'] }),
        roles.create({ name: 'admin', permissions: ['user:read', 'user:write'] }),
      ]);
    });
  });

  describe('constraints', () => {
    it('rejects a duplicate email at the database, not just in application code', async () => {
      await createUser({ email: 'dup@acme.test' });

      await expect(createUser({ email: 'dup@acme.test' })).rejects.toMatchObject({
        constructor: QueryFailedError,
        driverError: expect.objectContaining({ code: '23505' }),
      });
    });

    it('rejects a user pointing at a role that does not exist', async () => {
      await expect(createUser({ roleId: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({
        driverError: expect.objectContaining({ code: '23503' }),
      });
    });

    it('refuses to delete a role that still has users (onDelete: RESTRICT)', async () => {
      await createUser({ roleId: admin.id });

      await expect(dataSource.getRepository(RoleEntity).delete(admin.id)).rejects.toMatchObject({
        driverError: expect.objectContaining({ code: '23503' }),
      });
    });
  });

  describe('UserRepository', () => {
    it('returns the created user with its role already joined (re-fetched after save)', async () => {
      const user = await createUser();

      expect(user.role).toMatchObject({ id: accountant.id, name: 'accountant' });
      expect(user.isActive).toBe(true);
    });

    // Regression for the documented TypeORM pitfall: save()-ing an entity whose eager `role` is
    // already loaded silently restores the old roleId. update() must return the *new* role.
    it('changes a user’s role and returns the new role, not the stale eager one', async () => {
      const user = await createUser({ roleId: accountant.id });

      const updated = await users.update(user.id, { roleId: admin.id });

      expect(updated?.roleId).toBe(admin.id);
      expect(updated?.role.name).toBe('admin');
      expect((await users.findById(user.id))?.roleId).toBe(admin.id);
    });

    it('returns null when updating or deactivating a user that does not exist', async () => {
      const missing = '11111111-1111-1111-1111-111111111111';

      await expect(users.update(missing, { name: 'x' })).resolves.toBeNull();
      await expect(users.deactivate(missing)).resolves.toBeNull();
    });

    it('deactivates softly — the row stays, isActive flips', async () => {
      const user = await createUser();

      await users.deactivate(user.id);

      expect(await users.findById(user.id)).toMatchObject({ isActive: false });
    });

    it('lists with role joined, filters, and paginates newest first', async () => {
      const first = await createUser({ name: 'Alice Accountant' });
      const second = await createUser({ name: 'Bob Admin', roleId: admin.id });
      await createUser({ name: 'Carol Accountant' });
      await users.deactivate(first.id);

      const byRole = await users.findAll({ roleId: admin.id });
      expect(byRole.items.map((u) => u.id)).toEqual([second.id]);
      expect(byRole.items[0].role.name).toBe('admin');

      const active = await users.findAll({ isActive: true });
      expect(active.total).toBe(2);

      const page2 = await users.findAll({ page: 2, limit: 2 });
      expect(page2).toMatchObject({ total: 3 });
      expect(page2.items.map((u) => u.name)).toEqual(['Alice Accountant']);
    });

    it('searches name and email case-insensitively', async () => {
      await createUser({ name: 'Dana Smith', email: 'dana@acme.test' });
      await createUser({ name: 'Eve', email: 'eve@SMITHCO.test' });
      await createUser({ name: 'Frank', email: 'frank@acme.test' });

      const result = await users.findAll({ search: 'smith' });

      expect(result.items.map((u) => u.name).sort()).toEqual(['Dana Smith', 'Eve']);
    });

    // LIKE wildcards in user input must be matched literally: a search for "_" or "%" is a search
    // for that character, not "match everyone".
    it('treats % and _ in the search term as literal characters', async () => {
      await createUser({ name: 'Plain Name' });
      await createUser({ name: 'Under_Score' });
      await createUser({ name: '100% Owner' });

      expect((await users.findAll({ search: '_' })).items.map((u) => u.name)).toEqual(['Under_Score']);
      expect((await users.findAll({ search: '%' })).items.map((u) => u.name)).toEqual(['100% Owner']);
    });
  });
});
