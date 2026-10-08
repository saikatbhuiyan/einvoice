import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import {
  BaseKafkaProducer,
  INVOICE_EVENTS_TOPIC,
  kafkaClientToken,
  type InvoiceDemoEvent,
  type InvoicePdfGeneratedEvent,
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

  emitPdfGenerated(payload: Omit<InvoicePdfGeneratedEvent, 'type'>): void {
    const event: InvoicePdfGeneratedEvent = { type: 'invoice.pdf.generated', ...payload };
    this.emit(INVOICE_EVENTS_TOPIC, event, payload.invoiceId);
  }
}
