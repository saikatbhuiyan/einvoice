import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule as NestCacheModule, CACHE_MANAGER } from '@nestjs/cache-manager';
import { createKeyv } from '@keyv/redis';
import { createCache } from 'cache-manager';
import { RedisCacheConfiguration } from './cache.config';
import { REDIS_CLIENT } from './cache.constants';
import Redis from 'ioredis';

@Module({})
export class CacheModule {
  static forRoot(prefix = 'bff'): DynamicModule {
    return {
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

            const redisUrl = config.REDIS_PASSWORD
              ? `redis://:${config.REDIS_PASSWORD}@${config.REDIS_HOST}:${config.REDIS_PORT}/${config.REDIS_DB}`
              : `redis://${config.REDIS_HOST}:${config.REDIS_PORT}/${config.REDIS_DB}`;

            const keyv = createKeyv(redisUrl, { namespace: prefix });

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
  }
}
