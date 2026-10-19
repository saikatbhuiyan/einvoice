// PdfController imports PdfRendererService as a value (for DI metadata), which would load
// puppeteer-core (ESM-only). The real Chromium path is covered by pdf-renderer.service.int-spec.ts.
jest.mock('./pdf-renderer.service', () => ({ PdfRendererService: class {} }));

import { runWithCorrelationContext } from '@libs/logging';
import { createRpcEnvelope, type GenerateInvoicePdfRequest } from '@libs/transports';
import { PdfController } from './pdf.controller';
import type { PdfRendererService } from './pdf-renderer.service';
import type { TemplateRendererService } from './template-renderer.service';

const request = { invoiceNumber: 'INV-7', items: [] } as unknown as GenerateInvoicePdfRequest;

describe('PdfController', () => {
  const templateRenderer = { renderInvoiceHtml: jest.fn().mockResolvedValue('<html>INV-7</html>') };
  const pdfRenderer = { renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 bytes')) };
  const controller = new PdfController(
    templateRenderer as unknown as TemplateRendererService,
    pdfRenderer as unknown as PdfRendererService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('renders HTML, then PDF, and returns it base64-encoded with a derived file name', async () => {
    const response = await controller.generateInvoicePdf(request);

    expect(templateRenderer.renderInvoiceHtml).toHaveBeenCalledWith(request);
    expect(pdfRenderer.renderPdf).toHaveBeenCalledWith('<html>INV-7</html>');
    expect(response).toEqual({
      fileName: 'invoice-INV-7.pdf',
      contentType: 'application/pdf',
      base64: Buffer.from('%PDF-1.7 bytes').toString('base64'),
    });
  });

  it('unwraps an RpcEnvelope before rendering', async () => {
    const envelope = runWithCorrelationContext({ correlationId: 'c', traceId: 't', userId: 'u-1' }, () =>
      createRpcEnvelope(request, 'invoice'),
    );

    await controller.generateInvoicePdf(envelope);

    expect(templateRenderer.renderInvoiceHtml).toHaveBeenCalledWith(request);
  });

  it('propagates a Chromium failure instead of returning an empty PDF', async () => {
    pdfRenderer.renderPdf.mockRejectedValueOnce(new Error('Target closed'));

    await expect(controller.generateInvoicePdf(request)).rejects.toThrow('Target closed');
  });
});
