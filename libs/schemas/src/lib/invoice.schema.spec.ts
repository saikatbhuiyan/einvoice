import mongoose from 'mongoose';
import { InvoiceModelName, InvoiceSchema } from './invoice.schema';

describe('Invoice schema - recalculateTotals pre-validate hook', () => {
  const Invoice = mongoose.model(InvoiceModelName, InvoiceSchema);

  const client = {
    name: 'Acme Corp',
    email: 'billing@acme.test',
    address: '1 Infinite Loop, Cupertino',
  };

  it('rounds and sums per-item and invoice-level subtotal/vatTotal/total across multiple items', async () => {
    const invoice = new Invoice({
      invoiceNumber: 'INV-0001',
      client,
      currency: 'USD',
      items: [
        { catalogId: 'sku-1', name: 'Widget', quantity: 2, unitPrice: 10, vatRate: 20 },
        { catalogId: 'sku-2', name: 'Gadget', quantity: 1, unitPrice: 5.5, vatRate: 10 },
      ],
    });

    await invoice.validate();

    // item 1: subtotal 2*10=20, vat 20% => 4, total 24
    expect(invoice.items[0].total).toBe(24);
    // item 2: subtotal 5.5, vat 10% => 0.55, total 6.05
    expect(invoice.items[1].total).toBeCloseTo(6.05, 2);

    expect(invoice.subtotal).toBeCloseTo(25.5, 2);
    expect(invoice.vatTotal).toBeCloseTo(4.55, 2);
    expect(invoice.total).toBeCloseTo(30.05, 2);
  });

  it('rounds fractional cent results to 2 decimal places', async () => {
    const invoice = new Invoice({
      invoiceNumber: 'INV-0002',
      client,
      currency: 'USD',
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 3, unitPrice: 0.1, vatRate: 15 }],
    });

    await invoice.validate();

    // subtotal 3*0.1=0.3, vat 15% of 0.3 = 0.045 -> rounds to 0.05, total 0.35
    expect(invoice.items[0].total).toBeCloseTo(0.35, 2);
    expect(invoice.subtotal).toBeCloseTo(0.3, 2);
    expect(invoice.vatTotal).toBeCloseTo(0.05, 2);
    expect(invoice.total).toBeCloseTo(0.35, 2);
  });

  it('invalidates when dueDate is earlier than issueDate', async () => {
    const invoice = new Invoice({
      invoiceNumber: 'INV-0003',
      client,
      currency: 'USD',
      issueDate: new Date('2024-02-01'),
      dueDate: new Date('2024-01-01'),
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPrice: 10, vatRate: 0 }],
    });

    await expect(invoice.validate()).rejects.toThrow(/dueDate cannot be earlier than issueDate/);
  });

  it('does not invalidate when dueDate is on or after issueDate', async () => {
    const invoice = new Invoice({
      invoiceNumber: 'INV-0004',
      client,
      currency: 'USD',
      issueDate: new Date('2024-01-01'),
      dueDate: new Date('2024-01-01'),
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPrice: 10, vatRate: 0 }],
    });

    await expect(invoice.validate()).resolves.toBeUndefined();
  });
});
