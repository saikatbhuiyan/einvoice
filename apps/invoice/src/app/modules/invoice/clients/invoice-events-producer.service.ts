import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import {
  INVOICE_EVENTS_TOPIC,
  type InvoiceCancelledEvent,
  type InvoiceDemoEvent,
  type InvoiceSentEvent,
  type UnstampedInvoiceEvent,
} from '@libs/transports';
import { OutboxRepository } from '../../outbox/outbox.repository';

const SOURCE_SERVICE = 'invoice';

/**
 * Builds invoice's domain events and writes them to the transactional outbox, inside the caller's
 * transaction (each method takes the session of the write the event describes). Nothing here talks
 * to Kafka: the outbox relay publishes committed events. Every event is keyed by invoiceId so one
 * invoice's events stay ordered on one partition.
 */
@Injectable()
export class InvoiceEventsProducerService {
  constructor(private readonly outbox: OutboxRepository) {}

  enqueueDemo(session: ClientSession, invoiceId: string): Promise<string> {
    return this.enqueue<InvoiceDemoEvent>(session, invoiceId, {
      type: 'invoice.demo',
      invoiceId,
      message: `Invoice ${invoiceId} was created.`,
    });
  }

  enqueueSent(session: ClientSession, payload: Omit<UnstampedInvoiceEvent<InvoiceSentEvent>, 'type'>): Promise<string> {
    return this.enqueue<InvoiceSentEvent>(session, payload.invoiceId, { type: 'invoice.sent', ...payload });
  }

  enqueueCancelled(
    session: ClientSession,
    payload: Omit<UnstampedInvoiceEvent<InvoiceCancelledEvent>, 'type'>,
  ): Promise<string> {
    return this.enqueue<InvoiceCancelledEvent>(session, payload.invoiceId, { type: 'invoice.cancelled', ...payload });
  }

  private enqueue<T extends InvoiceDemoEvent | InvoiceSentEvent | InvoiceCancelledEvent>(
    session: ClientSession,
    invoiceId: string,
    event: UnstampedInvoiceEvent<T>,
  ): Promise<string> {
    return this.outbox.enqueue(session, { topic: INVOICE_EVENTS_TOPIC, key: invoiceId, data: event }, SOURCE_SERVICE);
  }
}
