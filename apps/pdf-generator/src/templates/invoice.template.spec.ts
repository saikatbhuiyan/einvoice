import { join } from 'path';
import * as ejs from 'ejs';
import type { GenerateInvoicePdfRequest } from '@libs/transports';
import { invoiceView } from './invoice-view';

// Renders the real template file. TemplateRendererService resolves it relative to the bundled
// main.js (dist/apps/pdf-generator/templates), so the spec points at the source copy directly.
const TEMPLATE = join(__dirname, 'invoice.ejs');

const render = (data: GenerateInvoicePdfRequest) => ejs.renderFile(TEMPLATE, invoiceView(data));

const line = (fields: Partial<GenerateInvoicePdfRequest['items'][number]>) => ({
  catalogId: 'sku',
  name: 'Item',
  quantity: 1,
  unitPriceMinor: 0,
  vatRate: 0,
  sdRate: 0,
  netMinor: 0,
  sdMinor: 0,
  vatMinor: 0,
  totalMinor: 0,
  ...fields,
});

const invoice = (): GenerateInvoicePdfRequest => ({
  invoiceNumber: 'INV-2026-001',
  client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Infinite Loop' },
  items: [
    line({
      name: 'Widget',
      quantity: 2,
      unitPriceMinor: 5000,
      vatRate: 10,
      netMinor: 10_000,
      vatMinor: 1000,
      totalMinor: 11_000,
    }),
    line({ name: 'Gadget', unitPriceMinor: 1990, netMinor: 1990, totalMinor: 1990 }),
  ],
  currency: 'EUR',
  status: 'sent',
  issueDate: '2026-10-01',
  dueDate: '2026-10-31',
  notes: 'Thank you for your business',
  netMinor: 11_990,
  sdMinor: 0,
  vatMinor: 1000,
  totalMinor: 12_990,
});

describe('invoice.ejs', () => {
  it('renders the header, every line item, and amounts formatted from minor units', async () => {
    const html = await render(invoice());

    expect(html).toContain('<title>Invoice INV-2026-001</title>');
    expect(html.match(/<td>(Widget|Gadget)<\/td>/g)).toEqual(['<td>Widget</td>', '<td>Gadget</td>']);
    expect(html).toContain('€19.90');
    expect(html).toContain('€129.90');
    expect(html).toContain('Total (EUR)');
    // No line has supplementary duty: no SD column, no SD total.
    expect(html).not.toContain('<th class="num">SD</th>');
    expect(html).not.toContain('Supplementary duty');
    expect(html).toContain('Issued: 01 Oct 2026');
    expect(html).toContain('Due: 31 Oct 2026');
    expect(html).toContain('Thank you for your business');
  });

  // Regression: optional fields arrive *absent* (JSON.stringify drops undefined-valued keys over
  // TCP), and a bare identifier for an absent key throws ReferenceError under EJS's with(locals).
  it('renders when optional keys are missing entirely, not just undefined', async () => {
    const { dueDate, notes, ...withoutOptionals } = invoice();
    const overTheWire = JSON.parse(JSON.stringify({ ...withoutOptionals, dueDate: undefined }));
    expect('dueDate' in overTheWire).toBe(false);

    const html = await render(overTheWire);

    expect(html).not.toContain('Due:');
    expect(html).not.toContain('class="notes"');
    expect(dueDate && notes).toBeTruthy();
  });

  it('formats BDT with the taka sign and lakh/crore grouping, and shows SD when a line has it', async () => {
    // 10 x ৳1,00,000 with SD 20% then VAT 15% on net + SD.
    const html = await render({
      ...invoice(),
      currency: 'BDT',
      items: [
        line({
          name: 'Air conditioner',
          quantity: 10,
          unitPriceMinor: 10_000_000,
          vatRate: 15,
          sdRate: 20,
          netMinor: 100_000_000,
          sdMinor: 20_000_000,
          vatMinor: 18_000_000,
          totalMinor: 138_000_000,
        }),
      ],
      netMinor: 100_000_000,
      sdMinor: 20_000_000,
      vatMinor: 18_000_000,
      totalMinor: 138_000_000,
    });

    expect(html).toContain('৳1,00,000.00'); // unit price
    expect(html).toContain('৳13,80,000.00'); // line and grand total
    expect(html).toContain('<th class="num">SD</th>');
    expect(html).toContain('<td class="num">20%</td>');
    expect(html).toContain('Supplementary duty</span><span>৳2,00,000.00');
  });

  // Issued 20:30 UTC on 31 Dec = 02:30 on 1 Jan in Dhaka: the printed date is the issuer's.
  it("prints the date of issue in the issuer's time zone, and a due date as the calendar date it is", async () => {
    const html = await render({
      ...invoice(),
      issueDate: '2026-12-31T20:30:00.000Z',
      dueDate: '2027-01-31T00:00:00.000Z',
      timeZone: 'Asia/Dhaka',
    });

    expect(html).toContain('Issued: 01 Jan 2027');
    expect(html).toContain('Due: 31 Jan 2027');
  });

  it('shows the seller and both BINs when there are any', async () => {
    const html = await render({
      ...invoice(),
      seller: { name: 'Acme Ltd.', bin: '0012345670101', address: 'Road 8, Dhaka' },
      client: { ...invoice().client, bin: '0098765430202' },
    });

    expect(html).toContain('<strong>Acme Ltd.</strong>');
    expect(html).toContain('BIN: 0012345670101');
    expect(html).toContain('BIN: 0098765430202');
    await expect(render(invoice())).resolves.not.toContain('BIN:');
  });

  it('omits the address line for a client without one', async () => {
    const data = invoice();
    delete data.client.address;

    await expect(render(data)).resolves.not.toContain('1 Infinite Loop');
  });

  // The HTML is rendered by a real Chromium; unescaped client data would execute as script there.
  it('HTML-escapes user-supplied text', async () => {
    const data = invoice();
    data.client.name = '<img src=x onerror="alert(1)">';
    data.notes = '<script>steal()</script>';

    const html = await render(data);

    expect(html).not.toContain('<script>steal()');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;steal()&lt;/script&gt;');
  });
});
