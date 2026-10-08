import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { CacheModule } from '@libs/cache';
import { RedisHealthIndicator } from '@libs/health';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: 'json' }), CacheModule.forRoot('bff')],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
