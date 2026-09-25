import { readFileSync } from 'fs';
import { join } from 'path';
import AppDataSource from '../data-source';
import { RoleEntity } from '../entities/role.entity';

interface RoleSeed {
  name: string;
  description: string;
  permissions: string[];
}

async function seedRoles(): Promise<void> {
  const seedPath = join(__dirname, 'roles.seed.json');
  const roles: RoleSeed[] = JSON.parse(readFileSync(seedPath, 'utf-8'));

  await AppDataSource.initialize();
  const repository = AppDataSource.getRepository(RoleEntity);

  // Upsert by name so re-running the seed (e.g. after editing roles.seed.json) is safe:
  // existing roles get their description/permissions refreshed, nothing is duplicated.
  await repository.upsert(
    roles.map((role) => ({ name: role.name, description: role.description, permissions: role.permissions })),
    ['name'],
  );

  console.log(`Seeded ${roles.length} role(s): ${roles.map((r) => r.name).join(', ')}`);

  await AppDataSource.destroy();
}

seedRoles().catch((error: unknown) => {
  console.error('Failed to seed roles:', error);
  process.exit(1);
});
