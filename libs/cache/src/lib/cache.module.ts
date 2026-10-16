import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { createKeyv } from '@keyv/redis';
import { createCache } from 'cache-manager';
import { RedisCacheConfiguration } from './cache.config';
import { REDIS_CLIENT } from './cache.constants';
import Redis from 'ioredis';

@Module({})
export class CacheModule {
  private static readonly modulesByPrefix = new Map<string, DynamicModule>();

  /**
   * Returns the same DynamicModule object for the same prefix on every call. Nest 11 identifies
   * dynamic modules by object reference by default, so a fresh object per call meant every
   * feature module that imported `CacheModule.forRoot('bff')` got its own module instance -- and
   * its own Redis connection (bff measured 7 connections from one process). Reusing the object
   * gives one instance, one REDIS_CLIENT, and lets the health check ping the same connection the
   * app actually uses.
   */
  static forRoot(prefix = 'bff'): DynamicModule {
    const existing = CacheModule.modulesByPrefix.get(prefix);
    if (existing) return existing;

    const dynamicModule: DynamicModule = {
      module: CacheModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
      ],
      providers: [
        {
          provide: CACHE_MANAGER,
          useFactory: (configService: ConfigService) => {
            const config = configService.get<RedisCacheConfiguration>('CACHE_CONFIG', { infer: true });

            // Structured options, not a redis:// URL: a password containing "@", "/", "#" or "?"
            // made the concatenated URL invalid and crashed every service at boot.
            const keyv = createKeyv(
              {
                socket: { host: config.REDIS_HOST, port: config.REDIS_PORT },
                password: config.REDIS_PASSWORD || undefined,
                database: config.REDIS_DB,
              },
              { namespace: prefix },
            );

            return createCache({
              stores: [keyv],
              ttl: config.CACHE_DEFAULT_TTL * 1000,
            });
          },
          inject: [ConfigService],
        },
        {
          provide: REDIS_CLIENT,
          useFactory: (configService: ConfigService) => {
            const config = configService.get<RedisCacheConfiguration>('CACHE_CONFIG', { infer: true });

            return new Redis({
              host: config.REDIS_HOST,
              port: config.REDIS_PORT,
              password: config.REDIS_PASSWORD || undefined,
              db: config.REDIS_DB,
            });
          },
          inject: [ConfigService],
        },
      ],
      exports: [CACHE_MANAGER, REDIS_CLIENT],
    };

    CacheModule.modulesByPrefix.set(prefix, dynamicModule);
    return dynamicModule;
  }
}
