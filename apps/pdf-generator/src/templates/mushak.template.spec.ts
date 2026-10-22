import { join } from 'path';
import * as ejs from 'ejs';
import type { GenerateInvoicePdfRequest } from '@libs/transports';
import { invoiceView } from './invoice-view';

// The real template file; TemplateRendererService resolves it next to the bundled main.js instead.
const TEMPLATE = join(__dirname, 'mushak-6.3.ejs');
const render = (data: GenerateInvoicePdfRequest) => ejs.renderFile(TEMPLATE, invoiceView(data));

/** Text only, whitespace collapsed: what a reader of the PDF sees, independent of markup. */
const text = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

// 10 x ৳1,00,000.50 with SD 20% then VAT 15%, plus 1.5 x ৳1,500.55 consulting at 7.5% -- the
// Phase 4b live example, issued at 10:11 Dhaka time.
const challan = (): GenerateInvoicePdfRequest => ({
  format: 'mushak-6.3',
  invoiceNumber: 'INV-2026-000017',
  seller: {
    name: 'Acme Ltd.',
    bin: '0012345670101',
    address: 'House 12, Road 8, Gulshan-1, Dhaka 1212',
    authorizedSignatory: { name: 'Rahim Uddin', designation: 'Accounts Manager' },
  },
  timeZone: 'Asia/Dhaka',
  client: {
    name: 'Dhaka Traders Ltd',
    email: 'ap@dhaka.test',
    address: 'Plot 4, Tejgaon I/A, Dhaka 1208',
    bin: '0098765430202',
  },
  items: [
    {
      catalogId: 'AC-1',
      name: 'Air conditioner 1.5 ton',
      unit: 'pcs',
      quantity: 10,
      unitPriceMinor: 10_000_050,
      vatRate: 15,
      sdRate: 20,
      netMinor: 100_000_500,
      sdMinor: 20_000_100,
      vatMinor: 18_000_090,
      totalMinor: 138_000_690,
    },
    {
      catalogId: 'CONSULT',
      name: 'Consulting',
      quantity: 1.5,
      unitPriceMinor: 150_055,
      vatRate: 7.5,
      sdRate: 0,
      netMinor: 225_083,
      sdMinor: 0,
      vatMinor: 16_881,
      totalMinor: 241_964,
    },
  ],
  currency: 'BDT',
  status: 'issued',
  issueDate: '2026-10-21T04:11:22.173Z',
  netMinor: 100_225_583,
  sdMinor: 20_000_100,
  vatMinor: 18_016_971,
  totalMinor: 138_242_654,
});

describe('mushak-6.3.ejs', () => {
  it("carries the NBR form's header and field labels", async () => {
    const page = text(await render(challan()));

    for (const label of [
      "Government of the People's Republic of Bangladesh",
      'National Board of Revenue',
      'MUSHAK-6.3',
      'Tax Challan',
      '[See Clauses (C) and (f) of Sub-Rule (1) of Rule 40]',
      'Name of Registered Person: Acme Ltd.',
      'BIN of Registered Person: 0012345670101',
      'Challan Issuing Address: House 12, Road 8, Gulshan-1, Dhaka 1212',
      'Name of Purchaser: Dhaka Traders Ltd',
      'BIN of Purchaser: 0098765430202',
      'Destination of Supply: Plot 4, Tejgaon I/A, Dhaka 1208',
      'Invoice No: INV-2026-000017',
      'Date of Issue: 21 Oct 2026',
      'Time of Issue: 10:11',
      'Name of organization Officer-in-charge: Rahim Uddin',
      'Designation: Accounts Manager',
      'Signature:',
      'Seal:',
      '* Value except all kinds of Tax.',
    ]) {
      expect(page).toContain(label);
    }
  });

  it('has the ten numbered columns, in order', async () => {
    const page = text(await render(challan()));

    const headings = [
      'S.L No',
      'Goods/Service Description (in cases with Brand Name)',
      'Unit of Supply',
      'Quantity',
      'Unit Value* (TAKA)',
      'Total Value* (TAKA)',
      'Amount of Supplementary Duty (TAKA)',
      'Value Added Tax Rate / Specific Tax',
      'Value Added Tax / Specific Tax Amount (TAKA)',
      'Value Including All Kinds of Duty & Tax (TAKA)',
    ];
    const positions = headings.map((heading) => page.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(page).toContain('1 2 3 4 5 6 7 8 9 10');
  });

  it('fills each line and the Total row from exact minor units, with lakh grouping and no currency sign', async () => {
    const page = text(await render(challan()));

    expect(page).toContain(
      '1 Air conditioner 1.5 ton pcs 10 1,00,000.50 10,00,005.00 2,00,001.00 15% 1,80,000.90 13,80,006.90',
    );
    // A line without a unit leaves column 3 empty.
    expect(page).toContain('2 Consulting 1.5 1,500.55 2,250.83 0.00 7.5% 168.81 2,419.64');
    expect(page).toContain('Total 10,02,255.83 2,00,001.00 1,80,169.71 13,82,426.54');
    expect(page).not.toContain('৳');
  });

  it('writes the total in words', async () => {
    expect(text(await render(challan()))).toContain(
      'In words: Taka Thirteen Lakh Eighty-Two Thousand Four Hundred Twenty-Six and Poisha Fifty-Four Only',
    );
  });

  it('leaves the purchaser BIN, unit and signatory blank when there are none (an unregistered buyer)', async () => {
    const data = challan();
    delete data.client.bin;
    delete data.seller?.authorizedSignatory;
    // Over TCP an absent optional key is missing entirely, not undefined.
    const page = text(await render(JSON.parse(JSON.stringify(data))));

    expect(page).toContain('BIN of Purchaser: Destination of Supply:');
    expect(page).toContain('Name of organization Officer-in-charge: Designation: Signature:');
  });

  it('marks a draft as not yet a tax invoice', async () => {
    const page = text(await render({ ...challan(), status: 'draft', invoiceNumber: 'DRAFT' }));

    expect(page).toContain('DRAFT — not a tax invoice until issued');
    await expect(render(challan()).then(text)).resolves.not.toContain('DRAFT');
  });

  it('HTML-escapes user-supplied text', async () => {
    const data = challan();
    data.client.name = '<script>steal()</script>';
    data.items[0].name = '<img src=x onerror=alert(1)>';

    const html = await render(data);

    expect(html).not.toContain('<script>steal()');
    expect(html).not.toContain('<img src=x');
  });
});
