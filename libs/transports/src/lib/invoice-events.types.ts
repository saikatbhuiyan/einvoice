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

export interface InvoicePdfGeneratedEvent {
  type: 'invoice.pdf.generated';
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

export type InvoiceEvent = InvoiceDemoEvent | InvoicePdfGeneratedEvent;
