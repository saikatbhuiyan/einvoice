import { join } from 'path';
import * as ejs from 'ejs';
import type { GenerateInvoicePdfRequest } from '@libs/transports';

// Renders the real template file. TemplateRendererService resolves it relative to the bundled
// main.js (dist/apps/pdf-generator/templates), so the spec points at the source copy directly.
const TEMPLATE = join(__dirname, 'invoice.ejs');

const render = (data: object) => ejs.renderFile(TEMPLATE, data);

const invoice = (): GenerateInvoicePdfRequest => ({
  invoiceNumber: 'INV-2026-001',
  client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Infinite Loop' },
  items: [
    { catalogId: 'sku-1', name: 'Widget', quantity: 2, unitPrice: 50, vatRate: 10, total: 110 },
    { catalogId: 'sku-2', name: 'Gadget', quantity: 1, unitPrice: 19.9, vatRate: 0, total: 19.9 },
  ],
  currency: 'EUR',
  status: 'sent',
  issueDate: '2026-10-01',
  dueDate: '2026-10-31',
  notes: 'Thank you for your business',
  subtotal: 119.9,
  vatTotal: 10,
  total: 129.9,
});

describe('invoice.ejs', () => {
  it('renders the header, every line item, and two-decimal totals', async () => {
    const html = await render(invoice());

    expect(html).toContain('<title>Invoice INV-2026-001</title>');
    expect(html.match(/<td>(Widget|Gadget)<\/td>/g)).toEqual(['<td>Widget</td>', '<td>Gadget</td>']);
    expect(html).toContain('19.90 EUR');
    expect(html).toContain('129.90 EUR');
    expect(html).toContain('Due: 2026-10-31');
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
