import { Module } from '@nestjs/common';
import { PdfController } from './pdf.controller';
import { TemplateRendererService } from './template-renderer.service';
import { PdfRendererService } from './pdf-renderer.service';

@Module({
  controllers: [PdfController],
  providers: [TemplateRendererService, PdfRendererService],
})
export class PdfModule {}
