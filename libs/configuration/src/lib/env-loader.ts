import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as dotenvExpand from 'dotenv-expand';

let envLoaded = false;

function loadIfExists(envPath: string, override = false): void {
  if (!fs.existsSync(envPath)) return;

  dotenvExpand.expand(
    dotenv.config({
      path: envPath,
      override,
    }),
  );
}

function isProductionEnvironment(nodeEnv: string): boolean {
  return nodeEnv === 'production';
}

export function loadEnvironmentFiles(): void {
  if (envLoaded) return;

  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  if (isProductionEnvironment(nodeEnv)) {
    envLoaded = true;
    return;
  }

  const workspaceRoot = process.cwd();
  const baseEnvPath = path.resolve(workspaceRoot, '.env');
  loadIfExists(baseEnvPath);

  const envAliases: Record<string, string[]> = {
    development: ['development', 'dev'],
    test: ['test'],
    staging: ['staging'],
  };

  const candidateEnvNames = envAliases[nodeEnv] ?? [nodeEnv];
  const candidateEnvPaths = [...new Set(candidateEnvNames.map((name) => path.resolve(workspaceRoot, `.env.${name}`)))];

  for (const envPath of candidateEnvPaths) {
    loadIfExists(envPath, true);
  }

  envLoaded = true;
}
