import 'reflect-metadata';
import { join } from 'path';
import { existsSync } from 'fs';
import { config as loadDotenv } from 'dotenv';
import { expand } from 'dotenv-expand';
import { DataSource } from 'typeorm';
import { RoleEntity } from './entities/role.entity';
import { UserEntity } from './entities/user.entity';

/**
 * CLI-only DataSource for the `typeorm` migration commands and the role seed script (see
 * the user-access:migration:* and user-access:seed:roles scripts in package.json). The
 * running app connects via PostgresModule instead, which never runs migrations itself --
 * migrations are an explicit, deliberate step, not something that happens implicitly on app boot.
 *
 * Deliberately self-contained (plain process.env + dotenv, not the app's CONFIGURATION
 * singleton or @libs/* path aliases): the `typeorm` CLI's ts-node loader resolves modules
 * on its own terms and doesn't have the workspace's path-alias mapping or webpack bundling
 * available to it (see apps/product/src/database/data-source.ts for the same pattern).
 */
const workspaceRoot = join(__dirname, '../../../..');
const nodeEnv = process.env['NODE_ENV'] ?? 'development';

if (nodeEnv !== 'production') {
  for (const file of ['.env', `.env.${nodeEnv === 'development' ? 'dev' : nodeEnv}`]) {
    const path = join(workspaceRoot, file);
    if (existsSync(path)) {
      expand(loadDotenv({ path }));
    }
  }
}

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env['POSTGRES_HOST'] ?? 'localhost',
  port: Number(process.env['POSTGRES_PORT'] ?? 5432),
  username: process.env['POSTGRES_USER'] ?? '',
  password: process.env['POSTGRES_PASSWORD'] ?? '',
  database: process.env['POSTGRES_DB'] ?? '',
  ssl: process.env['POSTGRES_SSL'] === 'true',
  entities: [RoleEntity, UserEntity],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
});

export default AppDataSource;
