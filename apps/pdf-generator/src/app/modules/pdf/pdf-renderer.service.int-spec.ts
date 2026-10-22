import { existsSync } from 'fs';
import { join } from 'path';
import * as ejs from 'ejs';
import { invoiceView } from '../../../templates/invoice-view';
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
    ejs.renderFile(
      join(__dirname, '../../../templates/invoice.ejs'),
      invoiceView({
        invoiceNumber: 'INV-PDF-1',
        client: { name: 'Acme Corp', email: 'billing@acme.test' },
        items: [
          {
            catalogId: 'sku-1',
            name: 'Widget',
            quantity: 2,
            unitPriceMinor: 5000,
            vatRate: 10,
            sdRate: 0,
            netMinor: 10_000,
            sdMinor: 0,
            vatMinor: 1000,
            totalMinor: 11_000,
          },
        ],
        currency: 'EUR',
        status: 'sent',
        issueDate: '2026-10-01',
        netMinor: 10_000,
        sdMinor: 0,
        vatMinor: 1000,
        totalMinor: 11_000,
      }),
    );

  it('reports the browser as connected after startup (the liveness signal)', () => {
    expect(renderer.isBrowserConnected()).toBe(true);
  });

  it('renders the invoice template to a real PDF document', async () => {
    const pdf = await renderer.renderPdf(await invoiceHtml());

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    expect(pdf.length).toBeGreaterThan(5_000);
  });

  /** Width and height of the first page, in points, from the PDF's MediaBox. */
  const pageSize = (pdf: Buffer) => {
    const match = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
    if (!match) throw new Error('No MediaBox in the PDF.');
    return { width: Number(match[1]), height: Number(match[2]) };
  };

  // The NBR form is landscape; the template's @page size must win over the renderer's A4 default.
  it('renders a Mushak-6.3 on A4 landscape, and the standard invoice on A4 portrait', async () => {
    const mushakHtml = await ejs.renderFile(
      join(__dirname, '../../../templates/mushak-6.3.ejs'),
      invoiceView({
        format: 'mushak-6.3',
        invoiceNumber: 'INV-2026-000001',
        seller: { name: 'Acme Ltd.', bin: '0012345670101', address: 'Road 8, Dhaka' },
        timeZone: 'Asia/Dhaka',
        client: { name: 'Dhaka Traders Ltd', email: 'ap@dhaka.test' },
        items: [
          {
            catalogId: 'AC-1',
            name: 'Air conditioner',
            unit: 'pcs',
            quantity: 1,
            unitPriceMinor: 10_000_000,
            vatRate: 15,
            sdRate: 20,
            netMinor: 10_000_000,
            sdMinor: 2_000_000,
            vatMinor: 1_800_000,
            totalMinor: 13_800_000,
          },
        ],
        currency: 'BDT',
        status: 'issued',
        issueDate: '2026-10-21T04:11:22.173Z',
        netMinor: 10_000_000,
        sdMinor: 2_000_000,
        vatMinor: 1_800_000,
        totalMinor: 13_800_000,
      }),
    );

    const mushak = pageSize(await renderer.renderPdf(mushakHtml));
    const standard = pageSize(await renderer.renderPdf(await invoiceHtml()));

    expect(mushak.width).toBeCloseTo(842, -1);
    expect(mushak.height).toBeCloseTo(595, -1);
    expect(standard.width).toBeCloseTo(595, -1);
    expect(standard.height).toBeCloseTo(842, -1);
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
