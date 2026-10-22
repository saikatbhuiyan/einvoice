import { BadRequestException } from '@nestjs/common';
import type { GenerateInvoicePdfRequest } from '@libs/transports';
import { TEMPLATE_FILES, TemplateRendererService } from './template-renderer.service';

const request = (fields: Partial<GenerateInvoicePdfRequest>) =>
  ({ invoiceNumber: 'INV-1', items: [], currency: 'BDT', ...fields }) as GenerateInvoicePdfRequest;

describe('TemplateRendererService', () => {
  const renderer = new TemplateRendererService();

  it('has a template for every document format', () => {
    expect(TEMPLATE_FILES).toEqual({ standard: 'invoice.ejs', 'mushak-6.3': 'mushak-6.3.ejs' });
  });

  // A tax challan without the registered person's BIN would be worse than none.
  it('refuses a Mushak-6.3 without the seller BIN, before rendering anything', async () => {
    await expect(renderer.renderInvoiceHtml(request({ format: 'mushak-6.3' }))).rejects.toThrow(
      new BadRequestException('A Mushak-6.3 needs the seller and its BIN.'),
    );
    await expect(
      renderer.renderInvoiceHtml(request({ format: 'mushak-6.3', seller: { name: 'Acme Ltd.' } })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a format it does not know', async () => {
    await expect(renderer.renderInvoiceHtml(request({ format: 'ubl' as never }))).rejects.toThrow(
      'Unknown document format "ubl".',
    );
  });
});
