import { existsSync } from 'fs';
import { join } from 'path';
import { config as loadDotenv } from 'dotenv';
import { expand } from 'dotenv-expand';
import mongoose, { type Connection } from 'mongoose';

/**
 * Shared by the one-off/deploy-time scripts in this directory: loads the same env files the app
 * does (none in production, where the environment is the deployment's), then opens one Mongo
 * connection from MONGODB_URI. Deliberately not the app's CONFIGURATION singleton, which would
 * demand every unrelated setting (Kafka, Redis, peers) just to touch Mongo.
 */
export async function openScriptConnection(): Promise<Connection> {
  const workspaceRoot = join(__dirname, '../../../../..');
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  if (nodeEnv !== 'production') {
    for (const file of ['.env', `.env.${nodeEnv === 'development' ? 'dev' : nodeEnv}`]) {
      const path = join(workspaceRoot, file);
      if (existsSync(path)) expand(loadDotenv({ path }));
    }
  }

  const uri = process.env['MONGODB_URI'];
  if (!uri) throw new Error('MONGODB_URI is not set.');

  return mongoose
    .createConnection(uri, { directConnection: process.env['MONGODB_DIRECT_CONNECTION'] === 'true' })
    .asPromise();
}

/** Runs `main`, exiting non-zero (with the error) if it fails. */
export function runScript(main: (dryRun: boolean) => Promise<void>): void {
  main(process.argv.includes('--dry-run')).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
