// class-transformer's @Type needs the Reflect metadata API, which Nest loads in the apps but nothing loads here.
import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { AppConfiguration } from './app.config';
import { BaseConfiguration } from './base.config';
import { MongoDbConfiguration } from './mongodb.config';
import { PostgresConfiguration } from './postgres.config';

/** Runs `build` with exactly `vars` set (on top of a copy of the real env), then restores it. */
function withEnv<T>(vars: Record<string, string | undefined>, build: () => T): T {
  const original = process.env;
  process.env = { ...original };
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return build();
  } finally {
    process.env = original;
  }
}

describe('BaseConfiguration.validate', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('passes for a known NODE_ENV and a global prefix, and derives the IS_* flags', () => {
    const config = withEnv({ NODE_ENV: 'staging', GLOBAL_PREFIX: 'api' }, () => new BaseConfiguration());

    expect(() => config.validate()).not.toThrow();
    expect(config).toMatchObject({ IS_STAGING: true, IS_PRODUCTION: false, IS_DEVELOPMENT: false, IS_TEST: false });
  });

  it('rejects a NODE_ENV typo like "prod", naming the field and every failed constraint', () => {
    const config = withEnv({ NODE_ENV: 'prod', GLOBAL_PREFIX: undefined }, () => new BaseConfiguration());

    expect(() => config.validate()).toThrow(/\[NODE_ENV\] NODE_ENV must be one of: development, production/);
    expect(() => config.validate()).toThrow(/\[GLOBAL_PREFIX\] GLOBAL_PREFIX should not be empty/);
  });

  it('flattens nested validation errors into dotted paths', () => {
    class WithNested extends BaseConfiguration {
      validateNested() {
        return this['flattenErrors']([
          { property: 'DB', children: [{ property: 'PORT', constraints: { min: 'PORT must not be less than 1' } }] },
        ] as never);
      }
    }
    const config = withEnv({ NODE_ENV: 'test', GLOBAL_PREFIX: 'api' }, () => new WithNested());

    expect(config.validateNested()).toEqual(['[DB.PORT] PORT must not be less than 1']);
  });
});

describe('AppConfiguration', () => {
  it('turns a non-numeric PORT into a validation error instead of NaN slipping through', () => {
    const config = withEnv({ PORT: 'abc', CORS_ORIGINS: '*' }, () => new AppConfiguration());

    expect(config.PORT).toBe(0);
    expect(validateSync(config).map((error) => error.property)).toEqual(['PORT']);
  });
});

describe('MongoDbConfiguration', () => {
  const clean = {
    MONGODB_DB_NAME: undefined,
    MONGO_DB: undefined,
    MONGODB_READ_URI: undefined,
    MONGODB_RETRY_WRITES: undefined,
    MONGODB_MAX_POOL_SIZE: undefined,
  };

  it('never exposes credentials in the sanitized URIs it logs', () => {
    const config = withEnv(
      {
        ...clean,
        MONGODB_URI: 'mongodb://root:s3cret@mongodb:27017/einvoice?authSource=admin',
        MONGODB_READ_URI: 'mongodb+srv://reader:hunter2@replica.example.net/einvoice',
      },
      () => new MongoDbConfiguration(),
    );

    expect(config.SANITIZED_URI).toBe('mongodb://***:***@mongodb:27017/einvoice?authSource=admin');
    expect(config.SANITIZED_READ_URI).toBe('mongodb+srv://***:***@replica.example.net/einvoice');
    expect(config.SANITIZED_URI + config.SANITIZED_READ_URI).not.toMatch(/s3cret|hunter2/);
  });

  it('reports an unparseable URI as invalid rather than echoing it back', () => {
    const config = withEnv({ ...clean, MONGODB_URI: 'mongodb://user:pa ss@[bad' }, () => new MongoDbConfiguration());

    expect(config.SANITIZED_URI).toBe('[invalid-mongodb-uri]');
  });

  it('infers the database name from the URI path when no name is configured', () => {
    const config = withEnv(
      { ...clean, MONGODB_URI: 'mongodb://u:p@mongodb:27017/einvoice_dev?authSource=admin' },
      () => new MongoDbConfiguration(),
    );

    expect(config.MONGODB_DB_NAME).toBe('einvoice_dev');
  });

  it('parses booleans and integers leniently, falling back to defaults on junk', () => {
    const config = withEnv(
      { ...clean, MONGODB_URI: 'mongodb://mongodb/x', MONGODB_RETRY_WRITES: 'off', MONGODB_MAX_POOL_SIZE: 'lots' },
      () => new MongoDbConfiguration(),
    );

    expect(config.MONGODB_RETRY_WRITES).toBe(false);
    expect(config.MONGODB_MAX_POOL_SIZE).toBe(20);
  });

  it('rejects a URI without a mongodb scheme', () => {
    const config = withEnv({ ...clean, MONGODB_URI: 'postgres://db/x' }, () => new MongoDbConfiguration());

    expect(validateSync(config).map((error) => error.property)).toContain('MONGODB_URI');
  });
});

describe('PostgresConfiguration', () => {
  it('masks the password in its sanitized URL', () => {
    const config = withEnv(
      { POSTGRES_HOST: 'postgres', POSTGRES_DB: 'einvoice', POSTGRES_USER: 'app', POSTGRES_PASSWORD: 's3cret' },
      () => new PostgresConfiguration(),
    );

    expect(config.SANITIZED_URL).toBe('postgresql://app:***@postgres:5432/einvoice');
  });

  it('requires credentials and a database name', () => {
    const config = withEnv(
      { POSTGRES_DB: undefined, POSTGRES_USER: undefined, POSTGRES_PASSWORD: undefined },
      () => new PostgresConfiguration(),
    );

    expect(validateSync(config).map((error) => error.property)).toEqual(
      expect.arrayContaining(['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']),
    );
  });
});
