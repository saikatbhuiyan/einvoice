import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('loadEnvironmentFiles', () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd();
  let dir: string;

  // A fresh module per test: the loader remembers (module-level) that it already ran.
  function freshLoader(): () => void {
    let loader!: () => void;
    jest.isolateModules(() => {
      loader = jest.requireActual<typeof import('./env-loader')>('./env-loader').loadEnvironmentFiles;
    });
    return loader;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'env-loader-'));
    writeFileSync(join(dir, '.env'), 'FROM_BASE=base\nSHARED=base\n');
    writeFileSync(join(dir, '.env.dev'), 'FROM_DEV=dev\nSHARED=dev\nEXPANDED=${FROM_BASE}-expanded\n');
    process.chdir(dir);
    process.env = { ...originalEnv };
    for (const key of ['FROM_BASE', 'FROM_DEV', 'SHARED', 'EXPANDED']) delete process.env[key];
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads .env then the .env.dev alias for development, without overriding earlier values', () => {
    process.env['NODE_ENV'] = 'development';

    freshLoader()();

    expect(process.env).toMatchObject({ FROM_BASE: 'base', FROM_DEV: 'dev', EXPANDED: 'base-expanded' });
    // dotenv never overrides a variable that's already set -- .env loads first, so it wins.
    expect(process.env['SHARED']).toBe('base');
  });

  it('never reads env files in production -- production config comes from the real environment only', () => {
    process.env['NODE_ENV'] = 'production';

    freshLoader()();

    expect(process.env['FROM_BASE']).toBeUndefined();
    expect(process.env['FROM_DEV']).toBeUndefined();
  });

  it('does not let a file override a variable the environment already set', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['FROM_DEV'] = 'from-real-env';

    freshLoader()();

    expect(process.env['FROM_DEV']).toBe('from-real-env');
  });

  it('only loads once per process', () => {
    process.env['NODE_ENV'] = 'development';
    const load = freshLoader();

    load();
    delete process.env['FROM_BASE'];
    load();

    expect(process.env['FROM_BASE']).toBeUndefined();
  });
});
