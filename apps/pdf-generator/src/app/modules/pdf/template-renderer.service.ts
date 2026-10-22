import { BadRequestException, Injectable } from '@nestjs/common';
import { join } from 'path';
import * as ejs from 'ejs';
import type { DocumentFormat, GenerateInvoicePdfRequest } from '@libs/transports';
import { invoiceView } from '../../../templates/invoice-view';

// dist/apps/pdf-generator/templates at runtime — the same __dirname-resolves-inside-the-bundled-
// app pattern documented in libs/transports/src/lib/grpc.config.ts for .proto files, applied here
// to .ejs templates via the matching `assets` entry in webpack.config.js.
const TEMPLATES_DIR = join(__dirname, 'templates');

/** One template per document format; invoice chooses the format (it owns the Mushak rule). */
export const TEMPLATE_FILES: Record<DocumentFormat, string> = {
  standard: 'invoice.ejs',
  'mushak-6.3': 'mushak-6.3.ejs',
};

@Injectable()
export class TemplateRendererService {
  async renderInvoiceHtml(invoice: GenerateInvoicePdfRequest): Promise<string> {
    const format = invoice.format ?? 'standard';
    const file = TEMPLATE_FILES[format];
    if (!file) throw new BadRequestException(`Unknown document format "${format}".`);
    // A tax challan without the registered person's name and BIN would be worse than none.
    if (format === 'mushak-6.3' && !invoice.seller?.bin) {
      throw new BadRequestException('A Mushak-6.3 needs the seller and its BIN.');
    }
    return ejs.renderFile(join(TEMPLATES_DIR, file), invoiceView(invoice));
  }
}
