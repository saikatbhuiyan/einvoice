import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PdfModule } from '../modules/pdf/pdf.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: 'json' }), PdfModule],
  controllers: [HealthController],
})
export class HealthModule {}
