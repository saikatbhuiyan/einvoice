import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RateLimitConfiguration } from './rate-limit.config';
import { RATE_LIMIT_STORAGE } from './rate-limit.constants';
import { RateLimitGuard } from './rate-limit.guard';
import { RedisTokenBucketStorage } from './rate-limit.storage';

@Global()
@Module({})
export class RateLimitModule {
  static forRoot(): DynamicModule {
    return {
      module: RateLimitModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
      ],
      providers: [
        {
          provide: RATE_LIMIT_STORAGE,
          useFactory: (configService: ConfigService) => {
            const config = configService.get<RateLimitConfiguration>('RATE_LIMIT_CONFIG', { infer: true });

            return new Redis({
              host: config.REDIS_HOST,
              port: config.REDIS_PORT,
              password: config.REDIS_PASSWORD || undefined,
              db: config.REDIS_DB,
            });
          },
          inject: [ConfigService],
        },
        RedisTokenBucketStorage,
        RateLimitGuard,
      ],
      exports: [RateLimitGuard, RATE_LIMIT_STORAGE],
    };
  }
}
