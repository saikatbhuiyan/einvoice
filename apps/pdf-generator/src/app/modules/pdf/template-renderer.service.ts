import { Injectable } from '@nestjs/common';
import { join } from 'path';
import * as ejs from 'ejs';
import type { GenerateInvoicePdfRequest } from '@libs/transports';

// dist/apps/pdf-generator/templates at runtime — the same __dirname-resolves-inside-the-bundled-
// app pattern documented in libs/transports/src/lib/grpc.config.ts for .proto files, applied here
// to .ejs templates via the matching `assets` entry in webpack.config.js.
const TEMPLATES_DIR = join(__dirname, 'templates');

@Injectable()
export class TemplateRendererService {
  async renderInvoiceHtml(invoice: GenerateInvoicePdfRequest): Promise<string> {
    return ejs.renderFile(join(TEMPLATES_DIR, 'invoice.ejs'), invoice);
  }
}
