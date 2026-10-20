// Kafka event payloads for the invoice.events topic -- consumed by services/mail (Go) and payment.
// The Go side can't import this file (it's outside the pnpm/Nx workspace); these types are the
// TypeScript half of a plain JSON contract pinned by the golden fixtures in
// libs/transports/src/contracts/kafka/, which both sides' contract tests assert against.
//
// Every event is written to invoice's transactional outbox and published by its relay, so delivery
// is at-least-once: consumers must dedupe on `eventId`.

export const INVOICE_EVENTS_TOPIC = 'invoice.events';

/** Stamped by the outbox when the event is written (the outbox row id). Unique per event. */
export interface InvoiceEventMetadata {
  eventId: string;
}

export interface InvoiceDemoEvent extends InvoiceEventMetadata {
  type: 'invoice.demo';
  invoiceId: string;
  message: string;
}

/**
 * The invoice was sent to the client: services/mail reads the PDF from the (private) bucket at
 * `pdfKey` and emails it to `clientEmail`. Emitted only by an explicit send, never by PDF
 * generation alone.
 *
 * Carries an S3 key, never a URL: a presigned URL in the event could expire before a lagging or
 * retrying consumer gets to it. Messages produced before this change carry `pdfUrl` instead (and no
 * `eventId`); the Go consumer still handles them.
 */
export interface InvoiceSentEvent extends InvoiceEventMetadata {
  type: 'invoice.sent';
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  pdfKey: string;
  fileName: string;
  currency: string;
  total: number;
  issueDate: string;
  dueDate?: string;
}

/**
 * The invoice was cancelled. payment expires any open Stripe checkout session for it, so the client
 * can no longer pay a cancelled invoice through a link they already have.
 */
export interface InvoiceCancelledEvent extends InvoiceEventMetadata {
  type: 'invoice.cancelled';
  invoiceId: string;
  invoiceNumber: string;
  cancelledAt: string;
}

/**
 * A payment reminder is due for an overdue invoice: services/mail emails the client, attaching the
 * PDF at `pdfKey`. Written by invoice's overdue scheduler (meta.systemActor = "overdue-job") in the
 * same transaction that records the reminder, so each scheduled reminder produces exactly one event.
 */
export interface InvoiceReminderEvent extends InvoiceEventMetadata {
  type: 'invoice.reminder';
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  pdfKey: string;
  fileName: string;
  currency: string;
  total: number;
  dueDate: string;
  /** Whole days past the due date when the reminder was sent (1 on the first overdue day). */
  daysOverdue: number;
  /** 1 for the first reminder sent for this invoice, 2 for the second, ... */
  reminderNumber: number;
}

export type InvoiceEvent = InvoiceDemoEvent | InvoiceSentEvent | InvoiceCancelledEvent | InvoiceReminderEvent;

/** An event as its producer builds it; the outbox adds the metadata. */
export type UnstampedInvoiceEvent<T extends InvoiceEvent> = Omit<T, keyof InvoiceEventMetadata>;
