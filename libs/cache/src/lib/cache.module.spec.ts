import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CacheModule } from './cache.module';
import { REDIS_CLIENT } from './cache.constants';

describe('CacheModule.forRoot', () => {
  // Nest 11 dedupes dynamic modules by object reference; a fresh object per call gave every
  // importing feature module its own instance and its own Redis connection (bff had 7).
  it('returns the identical module object for the same prefix', () => {
    expect(CacheModule.forRoot('spec-a')).toBe(CacheModule.forRoot('spec-a'));
  });

  it('returns distinct modules for distinct prefixes', () => {
    expect(CacheModule.forRoot('spec-a')).not.toBe(CacheModule.forRoot('spec-b'));
  });

  it('defaults the prefix to bff', () => {
    expect(CacheModule.forRoot()).toBe(CacheModule.forRoot('bff'));
  });

  it('exports both the cache manager and the raw Redis client', () => {
    expect(CacheModule.forRoot('spec-a').exports).toEqual([CACHE_MANAGER, REDIS_CLIENT]);
  });
});
