import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { InvoiceStatus } from '@libs/shared/types';
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
  expiresAt?: Date;
}

/** Only an invoice that has been issued and not yet settled or cancelled can take payment. */
const PAYABLE_INVOICE_STATUSES: readonly InvoiceStatus[] = ['issued', 'overdue'];

/**
 * An open session is handed out again only if the customer has at least this long to finish
 * paying through it; otherwise it is retired and a fresh one created.
 */
const MIN_REUSABLE_SESSION_LIFETIME_MS = 30 * 60 * 1000;

const PG_UNIQUE_VIOLATION = '23505';

/**
 * invoice answered markPaid with a deterministic refusal (the invoice can't become paid, or no
 * longer exists): retrying the webhook would get the same answer forever.
 */
const NON_RETRYABLE_MARK_PAID_STATUSES = new Set<number>([HttpStatus.NOT_FOUND, HttpStatus.CONFLICT]);

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

    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
      throw new ConflictException(`Cannot take payment for an invoice that is ${invoice.status}.`);
    }

    // Issued invoices are immutable, so an open session's amount can never be out of date.
    const open = await this.paymentRepository.findOpenByInvoiceId(invoiceId);
    if (open) {
      if (this.isReusable(open)) {
        return { checkoutUrl: open.checkoutUrl as string };
      }
      await this.retire(open);
    }

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
          ctx.expiresAt = session.expiresAt;
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
            expiresAt: ctx.expiresAt as Date,
          });
        },
      });

    try {
      await saga.execute(context);
    } catch (error) {
      if (!(error instanceof SagaExecutionError)) throw error;

      // A concurrent request for the same invoice persisted its open session first (partial unique
      // index). Our session was already expired by the saga's compensation; hand out the winner's.
      if (this.isUniqueViolation(error.cause)) {
        const winner = await this.paymentRepository.findOpenByInvoiceId(invoiceId);
        if (winner?.checkoutUrl) return { checkoutUrl: winner.checkoutUrl };
      }
      throw error.cause;
    }

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
      if (await this.paymentRepository.hasOtherPaidPayment(payment.invoiceId, payment.id)) {
        // The invoice was already paid through another session (e.g. one retired as nearly expired
        // while the customer was still on it). invoice's markPaid is idempotent, so without this
        // check the second charge would look like a normal success; it needs a refund instead.
        await this.paymentRepository.updateStatus(payment.id, 'reconciliation_required');
        this.logger.error(
          `Payment "${payment.id}" for invoice "${payment.invoiceId}" succeeded but the invoice was already paid through another payment -- flagged for reconciliation (refund).`,
        );
        return;
      }
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
        // Already logged + flagged for reconciliation above. A deterministic refusal from invoice
        // (e.g. the invoice was cancelled after this session was created) won't change on retry,
        // so the webhook is acknowledged; anything else propagates so bff's relay surfaces a
        // non-2xx and Stripe retries.
        if (this.isNonRetryableMarkPaidFailure(error.cause)) return;
        throw error.cause;
      }
      throw error;
    }

    this.logger.log(`Invoice "${payment.invoiceId}" marked paid via Stripe session "${payment.providerSessionId}".`);
  }

  /**
   * The invoice was cancelled: make its open checkout session unpayable, so the client can't pay a
   * cancelled invoice through a link they already have. Idempotent -- a redelivered event finds no
   * open session. Returns whether there was one.
   *
   * If the client completed checkout just before this ran, Stripe refuses the expiry (swallowed in
   * expireCheckoutSession) and its completion webhook still arrives; invoice then refuses mark-paid
   * for a cancelled invoice, and that payment is flagged reconciliation_required as before.
   */
  async expireOpenSessionForInvoice(invoiceId: string): Promise<boolean> {
    const open = await this.paymentRepository.findOpenByInvoiceId(invoiceId);
    if (!open) return false;
    await this.retire(open);
    return true;
  }

  private isReusable(payment: PaymentEntity): boolean {
    return (
      !!payment.checkoutUrl &&
      !!payment.expiresAt &&
      payment.expiresAt.getTime() - Date.now() > MIN_REUSABLE_SESSION_LIFETIME_MS
    );
  }

  /**
   * Makes sure a nearly-expired (or expiry-unknown) open session can't be paid through any more
   * before replacing it. Expiring at Stripe first matters: marking the row 'failed' alone would leave
   * a payable session behind that this system no longer treats as open.
   */
  private async retire(payment: PaymentEntity): Promise<void> {
    await this.paymentProvider.expireCheckoutSession(payment.providerSessionId);
    await this.paymentRepository.updateStatus(payment.id, 'failed');
  }

  private isUniqueViolation(error: unknown): boolean {
    return (error as { driverError?: { code?: string } } | null)?.driverError?.code === PG_UNIQUE_VIOLATION;
  }

  private isNonRetryableMarkPaidFailure(error: unknown): boolean {
    return error instanceof HttpException && NON_RETRYABLE_MARK_PAID_STATUSES.has(error.getStatus());
  }
}
