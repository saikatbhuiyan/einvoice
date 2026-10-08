import { createPinoHttpOptions, isIgnoredAutoLogPath, shouldPrettyPrint } from './logging.module';

describe('shouldPrettyPrint', () => {
  it('honors an explicit LOG_PRETTY over NODE_ENV', () => {
    expect(shouldPrettyPrint({ NODE_ENV: 'development', LOG_PRETTY: 'false' })).toBe(false);
    expect(shouldPrettyPrint({ NODE_ENV: 'production', LOG_PRETTY: 'true' })).toBe(true);
    expect(shouldPrettyPrint({ NODE_ENV: 'development', LOG_PRETTY: ' FALSE ' })).toBe(false);
  });

  it('falls back to pretty outside production when LOG_PRETTY is unset or unrecognized', () => {
    expect(shouldPrettyPrint({ NODE_ENV: 'development' })).toBe(true);
    expect(shouldPrettyPrint({ NODE_ENV: 'production' })).toBe(false);
    expect(shouldPrettyPrint({ NODE_ENV: 'production', LOG_PRETTY: 'yes' })).toBe(false);
  });
});

describe('isIgnoredAutoLogPath', () => {
  it.each(['/api/health/live', '/api/health/ready', '/api/health/dependencies', '/api/health', '/health', '/healthz'])(
    'ignores probe path %s',
    (path) => expect(isIgnoredAutoLogPath(path)).toBe(true),
  );

  it('ignores probe paths with a query string', () => {
    expect(isIgnoredAutoLogPath('/api/health/live?probe=docker')).toBe(true);
  });

  it.each(['/api/v1/invoices', '/api/v1/invoices/abc-123', '/api/v1/auth/login', '/api/healthy-invoices', undefined])(
    'logs ordinary path %s',
    (path) => expect(isIgnoredAutoLogPath(path)).toBe(false),
  );
});

describe('createPinoHttpOptions', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('emits string levels and no pretty transport in JSON mode', () => {
    process.env = { ...originalEnv, NODE_ENV: 'development', LOG_PRETTY: 'false' };

    const options = createPinoHttpOptions({ serviceName: 'invoice' });

    expect(options.transport).toBeUndefined();
    expect(options.formatters?.level?.('error', 50)).toEqual({ level: 'error' });
  });

  it('uses pino-pretty without a level formatter in pretty mode', () => {
    process.env = { ...originalEnv, NODE_ENV: 'development', LOG_PRETTY: 'true' };

    const options = createPinoHttpOptions({ serviceName: 'invoice' });

    expect(options.transport?.target).toBe('pino-pretty');
    expect(options.formatters).toBeUndefined();
  });
});
