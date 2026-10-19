import { existsSync } from 'fs';
import { join } from 'path';
import * as ejs from 'ejs';
import { PdfRendererService } from './pdf-renderer.service';

// Production points PUPPETEER_EXECUTABLE_PATH at the image's system Chromium. Locally and on CI,
// fall back to the usual install locations — and fail loudly rather than skip, because a skipped
// suite reads as a green one.
const CANDIDATES = [
  process.env['PUPPETEER_EXECUTABLE_PATH'],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter((path): path is string => Boolean(path));

const executablePath = CANDIDATES.find((path) => existsSync(path));

/**
 * Integration test: the real Chromium render path — launching the browser once, rendering the real
 * invoice template, and reusing that browser across requests.
 */
describe('PdfRendererService with a real Chromium', () => {
  let renderer: PdfRendererService;

  beforeAll(async () => {
    if (!executablePath) {
      throw new Error(`No Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH (tried: ${CANDIDATES.join(', ')}).`);
    }
    process.env['PUPPETEER_EXECUTABLE_PATH'] = executablePath;
    renderer = new PdfRendererService();
    await renderer.onModuleInit();
  });

  afterAll(async () => {
    await renderer?.onModuleDestroy();
  });

  const invoiceHtml = () =>
    ejs.renderFile(join(__dirname, '../../../templates/invoice.ejs'), {
      invoiceNumber: 'INV-PDF-1',
      client: { name: 'Acme Corp', email: 'billing@acme.test' },
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 2, unitPrice: 50, vatRate: 10, total: 110 }],
      currency: 'EUR',
      status: 'sent',
      issueDate: '2026-10-01',
      subtotal: 100,
      vatTotal: 10,
      total: 110,
    });

  it('reports the browser as connected after startup (the liveness signal)', () => {
    expect(renderer.isBrowserConnected()).toBe(true);
  });

  it('renders the invoice template to a real PDF document', async () => {
    const pdf = await renderer.renderPdf(await invoiceHtml());

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    expect(pdf.length).toBeGreaterThan(5_000);
  });

  it('serves concurrent renders from the one shared browser', async () => {
    const html = await invoiceHtml();

    const pdfs = await Promise.all(Array.from({ length: 4 }, () => renderer.renderPdf(html)));

    expect(pdfs.every((pdf) => pdf.subarray(0, 5).toString() === '%PDF-')).toBe(true);
    expect(renderer.isBrowserConnected()).toBe(true);
  });

  // Tabs must be closed even when rendering fails, or a long-running process leaks Chromium pages.
  it('closes its tab after each render', async () => {
    const browser = (renderer as unknown as { browser: { pages(): Promise<unknown[]> } }).browser;
    const before = (await browser.pages()).length;

    await renderer.renderPdf('<html><body>hi</body></html>');

    expect((await browser.pages()).length).toBe(before);
  });
});
