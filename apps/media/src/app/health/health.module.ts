import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MediaModule } from '../modules/media/media.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: 'json' }), MediaModule],
  controllers: [HealthController],
})
export class HealthModule {}
