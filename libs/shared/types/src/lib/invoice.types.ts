export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'cancelled', 'overdue'] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * The only legal status changes. An issued invoice is a legal document: it is never edited back
 * into a draft, and `paid`/`cancelled` are terminal (a mistake on an issued invoice is corrected
 * with a new document, not by rewriting this one). Drafts are discarded with DELETE, not cancelled.
 */
export const INVOICE_TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  draft: ['issued'],
  issued: ['paid', 'overdue', 'cancelled'],
  overdue: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

/** Only drafts may have their content edited or be deleted. */
export const EDITABLE_INVOICE_STATUSES: readonly InvoiceStatus[] = ['draft'];

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from].includes(to);
}

/** Every status an invoice can be in for a transition to `to` to be legal. */
export function statusesTransitionableTo(to: InvoiceStatus): InvoiceStatus[] {
  return INVOICE_STATUSES.filter((from) => canTransition(from, to));
}

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
