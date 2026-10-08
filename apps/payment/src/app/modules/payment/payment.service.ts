import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Saga, SagaExecutionError } from '@libs/saga';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';
import { IPaymentRepository, PAYMENT_REPOSITORY } from './payment.repository.interface';
import { InvoiceClientService } from './invoice-client.service';
import { PaymentEntity } from '../../../database/entities/payment.entity';

export interface CreateCheckoutSessionResponse {
  checkoutUrl: string;
}

interface CreateCheckoutSagaContext {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  providerSessionId?: string;
  checkoutUrl?: string;
}

interface MarkPaidSagaContext {
  payment: PaymentEntity;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    @Inject(PAYMENT_REPOSITORY) private readonly paymentRepository: IPaymentRepository,
    private readonly invoiceClient: InvoiceClientService,
  ) {}

  /**
   * A Checkout Session created at Stripe with no local record of it is a real gap, not a
   * hypothetical: if the persist below fails, a customer could still pay through that orphaned
   * session, and handleWebhookEvent's providerSessionId lookup would find nothing and silently
   * drop the event -- real money collected, invoice never marked paid. The saga's compensation
   * (expiring the Stripe session) closes that gap by making sure the session can't actually be
   * paid through once this system has no record of it.
   */
  async createCheckoutSession(invoiceId: string): Promise<CreateCheckoutSessionResponse> {
    const invoice = await this.invoiceClient.findOneInvoice(invoiceId);

    const context: CreateCheckoutSagaContext = {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.total,
      currency: invoice.currency,
    };

    const saga = new Saga<CreateCheckoutSagaContext>('CreateCheckoutSession');
    saga
      .addStep({
        name: 'createStripeSession',
        execute: async (ctx) => {
          const session = await this.paymentProvider.createCheckoutSession({
            invoiceId: ctx.invoiceId,
            invoiceNumber: ctx.invoiceNumber,
            amount: ctx.amount,
            currency: ctx.currency,
          });
          ctx.providerSessionId = session.providerSessionId;
          ctx.checkoutUrl = session.checkoutUrl;
        },
        compensate: async (ctx) => {
          await this.paymentProvider.expireCheckoutSession(ctx.providerSessionId as string);
        },
      })
      .addStep({
        name: 'persistPaymentRecord',
        execute: async (ctx) => {
          await this.paymentRepository.create({
            invoiceId: ctx.invoiceId,
            provider: 'stripe',
            providerSessionId: ctx.providerSessionId as string,
            status: 'pending',
            amount: ctx.amount,
            currency: ctx.currency,
            checkoutUrl: ctx.checkoutUrl as string,
          });
        },
      });

    await saga.execute(context);

    return { checkoutUrl: context.checkoutUrl as string };
  }

  async handleWebhookEvent(rawBodyBase64: string, signature: string): Promise<void> {
    if (!signature) {
      throw new BadRequestException('Missing webhook signature.');
    }

    const rawBody = Buffer.from(rawBodyBase64, 'base64');
    const event = this.paymentProvider.parseWebhookEvent(rawBody, signature);

    if (event.type === 'ignored' || !event.providerSessionId) {
      return;
    }

    const payment = await this.paymentRepository.findByProviderSessionId(event.providerSessionId);
    if (!payment) {
      this.logger.warn(`No payment record found for provider session "${event.providerSessionId}".`);
      return;
    }

    if (event.type === 'payment_succeeded') {
      await this.markPaid(payment);
      return;
    }

    if (event.type === 'payment_failed') {
      await this.paymentRepository.updateStatus(payment.id, 'failed');
    }
  }

  /**
   * Stripe has already confirmed the money moved by the time this runs -- if the second step
   * (telling invoice over TCP) fails, this system and invoice's Mongo document now disagree
   * about the same fact. Reverting to 'pending' would erase that Stripe already confirmed
   * payment; staying silently on 'paid' would claim invoice agrees when it might not. The
   * compensation instead flags 'reconciliation_required' -- a distinct state for deliberate
   * follow-up, logged at error level because this is a money-reconciliation condition, not a
   * routine retry.
   */
  private async markPaid(payment: PaymentEntity): Promise<void> {
    const context: MarkPaidSagaContext = { payment };

    const saga = new Saga<MarkPaidSagaContext>('MarkInvoicePaid');
    saga
      .addStep({
        name: 'markPaymentPaid',
        execute: async (ctx) => {
          await this.paymentRepository.updateStatus(ctx.payment.id, 'paid');
        },
        compensate: async (ctx) => {
          await this.paymentRepository.updateStatus(ctx.payment.id, 'reconciliation_required');
          this.logger.error(
            `Payment "${ctx.payment.id}" for invoice "${ctx.payment.invoiceId}" confirmed paid by Stripe but could not be reflected on the invoice -- flagged for reconciliation.`,
          );
        },
      })
      .addStep({
        name: 'markInvoicePaid',
        execute: async (ctx) => {
          await this.invoiceClient.markInvoicePaid(ctx.payment.invoiceId);
        },
      });

    try {
      await saga.execute(context);
    } catch (error) {
      if (error instanceof SagaExecutionError) {
        // Already logged + flagged for reconciliation above; this is a webhook handler, not an
        // HTTP request -- there's no caller waiting on a response to shape, but the failure still
        // needs to propagate so bff's relay surfaces a non-2xx and Stripe retries the webhook.
        throw error.cause;
      }
      throw error;
    }

    this.logger.log(`Invoice "${payment.invoiceId}" marked paid via Stripe session "${payment.providerSessionId}".`);
  }
}
