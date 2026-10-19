import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import {
  BaseKafkaProducer,
  INVOICE_EVENTS_TOPIC,
  kafkaClientToken,
  type InvoiceDemoEvent,
  type InvoiceSentEvent,
} from '@libs/transports';

const KAFKA_CLIENT_ID = 'invoice';

@Injectable()
export class InvoiceEventsProducerService extends BaseKafkaProducer {
  protected readonly logger = new Logger(InvoiceEventsProducerService.name);
  protected override readonly sourceService = 'invoice';

  constructor(
    @Inject(kafkaClientToken(KAFKA_CLIENT_ID))
    protected readonly client: ClientKafka,
  ) {
    super();
  }

  emitDemo(invoiceId: string): void {
    const event: InvoiceDemoEvent = {
      type: 'invoice.demo',
      invoiceId,
      message: `Invoice ${invoiceId} was created.`,
    };
    this.emit(INVOICE_EVENTS_TOPIC, event, invoiceId);
  }

  emitSent(payload: Omit<InvoiceSentEvent, 'type'>): void {
    const event: InvoiceSentEvent = { type: 'invoice.sent', ...payload };
    this.emit(INVOICE_EVENTS_TOPIC, event, payload.invoiceId);
  }
}
