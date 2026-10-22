import type { GenerateInvoicePdfRequest } from '@libs/transports';
import { localDateTime, type SupportedCurrency } from '@libs/shared/types';
import { amountInWords, formatAmount, formatMoney } from '@libs/money';

/** What invoice.ejs and mushak-6.3.ejs render: the request plus presentation helpers. */
export interface InvoiceView extends GenerateInvoicePdfRequest {
  /** Minor units -> the currency's usual display (BDT: ৳1,50,000.00, lakh/crore grouping). */
  money: (minor: number) => string;
  /** Minor units -> a grouped number without symbol, for columns headed "(TAKA)". */
  amount: (minor: number) => string;
  /** Whether any line carries supplementary duty: the standard layout's SD column only appears then. */
  hasSd: boolean;
  /** The date and time of issue, on the issuer's wall clock (`timeZone`). */
  issued: { date: string; time: string };
  /** The due date: a calendar date, shown as one. */
  due?: string;
  /** The total in words ("Taka … and Poisha … Only"). */
  totalInWords: string;
}

const DISPLAY_DATE = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone });

export function invoiceView(invoice: GenerateInvoicePdfRequest): InvoiceView {
  const currency = invoice.currency as SupportedCurrency;
  const timeZone = invoice.timeZone ?? 'UTC';
  const issuedAt = new Date(invoice.issueDate);
  return {
    ...invoice,
    money: (minor) => formatMoney(minor, currency),
    amount: (minor) => formatAmount(minor, currency),
    hasSd: invoice.items.some((item) => item.sdMinor > 0 || item.sdRate > 0),
    issued: { date: DISPLAY_DATE(timeZone).format(issuedAt), time: localDateTime(issuedAt, timeZone).time },
    // Stored as midnight UTC of the due date, so it is read back in UTC: any other zone could shift it a day.
    due: invoice.dueDate ? DISPLAY_DATE('UTC').format(new Date(invoice.dueDate)) : undefined,
    totalInWords: amountInWords(invoice.totalMinor, currency),
  };
}
