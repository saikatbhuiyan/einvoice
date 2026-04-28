export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'cancelled', 'overdue'] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const SUPPORTED_CURRENCIES = ['BDT', 'USD', 'EUR', 'GBP'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const INVOICE_CONSTRAINTS = {
  invoiceNumber: { minLength: 3, maxLength: 32 },
  client: {
    name: { minLength: 3, maxLength: 120 },
    email: { maxLength: 320 },
    address: { minLength: 5, maxLength: 300 },
  },
  item: {
    catalogId: { minLength: 1, maxLength: 64 },
    name: { minLength: 1, maxLength: 160 },
    quantity: { min: 1, max: 1_000_000, maxDecimalPlaces: 2 },
    unitPrice: { min: 0, max: 1_000_000_000, maxDecimalPlaces: 2 },
    vatRate: { min: 0, max: 100, maxDecimalPlaces: 2 },
  },
  notes: { maxLength: 1000 },
} as const;
