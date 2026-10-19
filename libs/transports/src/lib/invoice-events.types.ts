// Kafka event payloads for the invoice.events topic -- consumed by services/mail (Go), which
// can't import this file directly (it's outside the pnpm/Nx workspace). These types are the
// TypeScript half of a plain JSON contract documented for the Go side too; keep both in sync by
// hand when either changes.

export const INVOICE_EVENTS_TOPIC = 'invoice.events';

export interface InvoiceDemoEvent {
  type: 'invoice.demo';
  invoiceId: string;
  message: string;
}

/**
 * The invoice was sent to the client: services/mail emails `clientEmail` with the PDF at `pdfUrl`
 * attached. Emitted only by an explicit send, never by PDF generation alone.
 *
 * Replaces `invoice.pdf.generated` (identical payload), which was emitted on every PDF render and
 * so re-emailed the client for internal previews. The Go consumer still accepts the old type for
 * messages already on the topic; nothing produces it any more.
 */
export interface InvoiceSentEvent {
  type: 'invoice.sent';
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  pdfUrl: string;
  fileName: string;
  currency: string;
  total: number;
  issueDate: string;
  dueDate?: string;
}

export type InvoiceEvent = InvoiceDemoEvent | InvoiceSentEvent;
