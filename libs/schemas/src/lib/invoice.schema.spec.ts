import mongoose from 'mongoose';
import { InvoiceModelName, InvoiceSchema } from './invoice.schema';

describe('Invoice schema - pre-validate tax computation', () => {
  const Invoice = mongoose.model(InvoiceModelName, InvoiceSchema);

  const ORG = '00000000-0000-4000-8000-000000000001';
  const client = {
    name: 'Acme Corp',
    email: 'billing@acme.test',
    address: '1 Infinite Loop, Cupertino',
  };

  it('computes every line in exact minor units and totals as the sums of the lines', async () => {
    const invoice = new Invoice({
      organizationId: ORG,
      client,
      currency: 'USD',
      items: [
        { catalogId: 'sku-1', name: 'Widget', quantity: 2, unitPriceMinor: 1000, vatRate: 20 },
        { catalogId: 'sku-2', name: 'Gadget', quantity: 1, unitPriceMinor: 550, vatRate: 10 },
      ],
    });

    await invoice.validate();

    // 2 x 10.00 = 20.00, VAT 20% = 4.00
    expect(invoice.items[0]).toMatchObject({ netMinor: 2000, sdMinor: 0, vatMinor: 400, totalMinor: 2400 });
    // 5.50, VAT 10% = 0.55
    expect(invoice.items[1]).toMatchObject({ netMinor: 550, sdMinor: 0, vatMinor: 55, totalMinor: 605 });
    expect(invoice).toMatchObject({ netMinor: 2550, sdMinor: 0, vatMinor: 455, totalMinor: 3005 });
  });

  it('rounds each line half-up at the minor unit', async () => {
    const invoice = new Invoice({
      organizationId: ORG,
      client,
      currency: 'USD',
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 3, unitPriceMinor: 10, vatRate: 15 }],
    });

    await invoice.validate();

    // 3 x 0.10 = 0.30; 15% of 0.30 = 0.045 -> 0.05
    expect(invoice).toMatchObject({ netMinor: 30, vatMinor: 5, totalMinor: 35 });
  });

  // Bangladesh: VAT is charged on the value including supplementary duty.
  it('charges SD on the net amount and VAT on net + SD', async () => {
    const invoice = new Invoice({
      organizationId: ORG,
      client,
      currency: 'BDT',
      items: [
        {
          catalogId: 'AC-1',
          name: 'Air conditioner',
          quantity: 10,
          unitPriceMinor: 10_000_000,
          vatRate: 15,
          sdRate: 20,
        },
      ],
    });

    await invoice.validate();

    expect(invoice.items[0]).toMatchObject({
      netMinor: 100_000_000,
      sdMinor: 20_000_000,
      vatMinor: 18_000_000,
      totalMinor: 138_000_000,
    });
    expect(invoice.totalMinor).toBe(138_000_000);
  });

  // Totals are never taken from the caller: the hook overwrites whatever was set.
  it('recomputes totals that were set directly', async () => {
    const invoice = new Invoice({
      organizationId: ORG,
      client,
      currency: 'USD',
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPriceMinor: 1000, vatRate: 0, totalMinor: 1 }],
      totalMinor: 1,
    });

    await invoice.validate();

    expect(invoice.items[0].totalMinor).toBe(1000);
    expect(invoice.totalMinor).toBe(1000);
  });

  it('rejects a fractional minor-unit price and a quantity with more than two decimals', async () => {
    const fractionalPrice = new Invoice({
      organizationId: ORG,
      client,
      currency: 'USD',
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPriceMinor: 10.5, vatRate: 0 }],
    });
    await expect(fractionalPrice.validate()).rejects.toThrow(/unitPriceMinor/);

    const fineQuantity = new Invoice({
      organizationId: ORG,
      client,
      currency: 'USD',
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1.005, unitPriceMinor: 1000, vatRate: 0 }],
    });
    await expect(fineQuantity.validate()).rejects.toThrow(/at most 2 decimal places/);
  });

  // Every invoice belongs to an organization: tenancy is enforced at the schema too, not only by
  // the repository's queries.
  it('requires an organization', async () => {
    const invoice = new Invoice({
      client,
      currency: 'USD',
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPriceMinor: 1000, vatRate: 0 }],
    });

    await expect(invoice.validate()).rejects.toMatchObject({ errors: { organizationId: expect.anything() } });
  });

  // "Due on receipt": the due date is today's date, the issue date is a later instant of today.
  it('accepts a due date on the issue day', async () => {
    const invoice = new Invoice({
      organizationId: ORG,
      client,
      currency: 'USD',
      issueDate: new Date('2026-10-20T10:30:00.000Z'),
      dueDate: new Date('2026-10-20T00:00:00.000Z'),
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPriceMinor: 1000, vatRate: 0 }],
    });

    await expect(invoice.validate()).resolves.toBeUndefined();
  });

  it('invalidates when dueDate is earlier than issueDate', async () => {
    const invoice = new Invoice({
      organizationId: ORG,
      client,
      currency: 'USD',
      issueDate: new Date('2024-02-01'),
      dueDate: new Date('2024-01-01'),
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPriceMinor: 1000, vatRate: 0 }],
    });

    await expect(invoice.validate()).rejects.toThrow(/dueDate cannot be earlier than issueDate/);
  });

  it('does not invalidate when dueDate is on or after issueDate', async () => {
    const invoice = new Invoice({
      organizationId: ORG,
      client,
      currency: 'USD',
      issueDate: new Date('2024-01-01'),
      dueDate: new Date('2024-01-01'),
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPriceMinor: 1000, vatRate: 0 }],
    });

    await expect(invoice.validate()).resolves.toBeUndefined();
  });
});
