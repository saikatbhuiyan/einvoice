import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  GenerateInvoicePdfRequest,
  GenerateInvoicePdfResponse,
  TCP_PATTERNS,
  unwrapRpcPayload,
  type RpcEnvelope,
} from '@libs/transports';
import { RequirePermission } from '@libs/auth/require-permission.decorator';
import { TemplateRendererService } from './template-renderer.service';
import { PdfRendererService } from './pdf-renderer.service';

@Controller()
export class PdfController {
  constructor(
    private readonly templateRenderer: TemplateRendererService,
    private readonly pdfRenderer: PdfRendererService,
  ) {}

  // invoice forwards whatever identity/permissions it received from bff (RpcLoggingInterceptor's
  // runWithCorrelationContext is what makes that automatic) — gating on invoice:read here is
  // defense-in-depth, the same "verify the shape of what was already resolved, at every hop" model
  // RpcPermissionGuard already applies everywhere else, not a new check invented for this handler.
  @RequirePermission('invoice:read')
  @MessagePattern(TCP_PATTERNS.PDF_GENERATOR.GENERATE_INVOICE_PDF)
  async generateInvoicePdf(
    @Payload() payload: RpcEnvelope<GenerateInvoicePdfRequest> | GenerateInvoicePdfRequest,
  ): Promise<GenerateInvoicePdfResponse> {
    const invoice = unwrapRpcPayload(payload);
    const html = await this.templateRenderer.renderInvoiceHtml(invoice);
    const pdf = await this.pdfRenderer.renderPdf(html);

    return {
      fileName: `invoice-${invoice.invoiceNumber}.pdf`,
      contentType: 'application/pdf',
      base64: pdf.toString('base64'),
    };
  }
}
