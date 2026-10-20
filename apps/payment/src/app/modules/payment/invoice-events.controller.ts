import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload, Transport } from '@nestjs/microservices';
import { Public } from '@libs/auth/public.decorator';
import { getCurrentCorrelationContext, runInOrganization } from '@libs/logging/correlation-context';
import { DEFAULT_ORGANIZATION_ID } from '@libs/shared/types';
import { INVOICE_EVENTS_TOPIC, unwrapRpcPayload, type InvoiceEvent, type RpcEnvelope } from '@libs/transports';
import { PaymentService } from './payment.service';

/**
 * Consumes invoice's domain events (Kafka, consumer group `payment`). Nest routes Kafka by topic, so
 * this one handler sees every event type on invoice.events and acts only on the ones payment cares
 * about.
 *
 * Delivery is at-least-once and a thrown error makes Kafka redeliver (see createKafkaConsumerConfig),
 * so each reaction must be idempotent -- expiring an invoice's open checkout session is: a second
 * delivery finds no open session.
 */
@Controller()
export class InvoiceEventsController {
  private readonly logger = new Logger(InvoiceEventsController.name);

  constructor(private readonly paymentService: PaymentService) {}

  // Transport.KAFKA: without it Nest would also register this handler on payment's TCP server (see
  // PaymentRpcController). @Public(): an event, not a user request -- there's no caller permission to check. The guard
  // still requires a well-formed envelope, which every outbox-published event carries.
  @Public()
  @EventPattern(INVOICE_EVENTS_TOPIC, Transport.KAFKA)
  async handle(@Payload() payload: RpcEnvelope<InvoiceEvent> | InvoiceEvent): Promise<void> {
    const event = unwrapRpcPayload(payload);

    if (event.type === 'invoice.cancelled') {
      // The event's organization arrives in its envelope (RpcLoggingInterceptor made it the context).
      // Events written to the outbox before tenancy carry none; they can only be about pre-tenancy
      // invoices, which all live in the default organization now. (Throwing instead would make
      // Kafka redeliver the event forever.)
      const organizationId = getCurrentCorrelationContext()?.organizationId ?? DEFAULT_ORGANIZATION_ID;
      const expired = await runInOrganization(organizationId, () =>
        this.paymentService.expireOpenSessionForInvoice(event.invoiceId),
      );
      this.logger.log(
        `invoice.cancelled ${event.invoiceId} (event ${event.eventId}): ${expired ? 'expired its open checkout session' : 'no open checkout session'}`,
      );
    }
  }
}
