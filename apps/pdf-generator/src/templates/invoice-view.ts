import type { GenerateInvoicePdfRequest } from '@libs/transports';
import type { SupportedCurrency } from '@libs/shared/types';
import { formatMoney } from '@libs/money';

/** What invoice.ejs renders: the request plus presentation helpers. */
export interface InvoiceView extends GenerateInvoicePdfRequest {
  /** Minor units -> the currency's usual display (BDT: ৳1,50,000.00, lakh/crore grouping). */
  money: (minor: number) => string;
  /** Whether any line carries supplementary duty: the SD column and total only appear then. */
  hasSd: boolean;
}

export function invoiceView(invoice: GenerateInvoicePdfRequest): InvoiceView {
  const currency = invoice.currency as SupportedCurrency;
  return {
    ...invoice,
    money: (minor) => formatMoney(minor, currency),
    hasSd: invoice.items.some((item) => item.sdMinor > 0 || item.sdRate > 0),
  };
}
