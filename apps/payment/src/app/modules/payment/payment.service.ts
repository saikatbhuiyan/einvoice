import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { InvoiceStatus, SupportedCurrency } from '@libs/shared/types';
import type {
  AttentionPaymentResponse,
  CreateCheckoutSessionResponse,
  InvoiceResponse,
  LedgerEntryResponse,
  PaymentOutcome,
  SslCommerzNotification,
} from '@libs/interfaces/gateway';
import { formatMoney, fromMinor, toMinor } from '@libs/money';
import { Saga, SagaExecutionError } from '@libs/saga';
import { runInOrganization } from '@libs/logging/correlation-context';
import {
  PAYMENT_PROVIDER,
  type CheckoutProvider,
  type CheckoutSessionParams,
  type PaymentProvider,
  type WebhookEventType,
} from './payment-provider.interface';
import { IPaymentRepository, PAYMENT_REPOSITORY } from './payment.repository.interface';
import { InvoiceClientService } from './invoice-client.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { LedgerService } from './ledger/ledger.service';
import { balanceDueOf } from './invoice-amounts';
import { SslCommerzRejectedError, SslCommerzUnavailableError } from './sslcommerz/sslcommerz.client';
import { PaymentEntity, type PaymentStatus } from '../../../database/entities/payment.entity';

interface CreateCheckoutSagaContext {
  params: CheckoutSessionParams;
  paymentId?: string;
  providerSessionId?: string;
  checkoutUrl?: string;
  expiresAt?: Date;
}

/** A row in one of these has been settled, or is waiting for a human: notifications change nothing. */
const SETTLED_STATUSES: readonly PaymentStatus[] = ['paid', 'review_required', 'reconciliation_required'];

const TRAN_ID = /^[A-Za-z0-9_-]{1,30}$/;

/** Only an invoice that has been issued and not yet settled or cancelled can take payment. */
const PAYABLE_INVOICE_STATUSES: readonly InvoiceStatus[] = ['issued', 'overdue'];

/**
 * An open session is handed out again only if the customer has at least this long to finish
 * paying through it; otherwise it is retired and a fresh one created.
 */
const MIN_REUSABLE_SESSION_LIFETIME_MS = 30 * 60 * 1000;

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    @Inject(PAYMENT_REPOSITORY) private readonly paymentRepository: IPaymentRepository,
    private readonly invoiceClient: InvoiceClientService,
    private readonly providers: PaymentProviderRegistry,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * A payment link for an issued or overdue invoice, from the provider its currency and organization
   * call for (PaymentProviderRegistry). An open session is reused while it has time left.
   */
  async createCheckoutSession(invoiceId: string, requestedAmount?: number): Promise<CreateCheckoutSessionResponse> {
    const invoice = await this.invoiceClient.findOneInvoice(invoiceId);

    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
      throw new ConflictException(`Cannot take payment for an invoice that is ${invoice.status}.`);
    }

    const provider = await this.providers.forCheckout(invoice.currency);
    const amount = this.checkoutAmount(provider, invoice, requestedAmount);

    // One open session per invoice: reused when it is for the same provider and amount, else retired.
    const open = await this.paymentRepository.findOpenByInvoiceId(invoiceId);
    if (open) {
      if (open.provider === provider.name && open.amount === amount && this.isReusable(open)) {
        return { checkoutUrl: open.checkoutUrl as string, provider: provider.name };
      }
      await this.retire(open);
    }

    const params: CheckoutSessionParams = {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber as string,
      amount,
      currency: invoice.currency,
      customer: {
        name: invoice.client.name,
        email: invoice.client.email,
        ...(invoice.client.phone ? { phone: invoice.client.phone } : {}),
        ...(invoice.client.address ? { address: invoice.client.address } : {}),
      },
    };
    const checkoutUrl = provider.canExpireSessions
      ? await this.createExpirableSession(provider, params)
      : await this.createRecordedSession(provider, params);
    return { checkoutUrl, provider: provider.name };
  }

  /**
   * Stripe: session first, then the local record. A session created with no local record of it is a
   * real gap -- a customer could pay through it and the webhook would find nothing -- so the saga's
   * compensation expires the session if the record can't be written.
   */
  private async createExpirableSession(provider: CheckoutProvider, params: CheckoutSessionParams): Promise<string> {
    const context: CreateCheckoutSagaContext = { params };

    const saga = new Saga<CreateCheckoutSagaContext>('CreateCheckoutSession');
    saga
      .addStep({
        name: 'createProviderSession',
        execute: async (ctx) => {
          const session = await provider.createCheckoutSession(ctx.params);
          ctx.providerSessionId = session.providerSessionId;
          ctx.checkoutUrl = session.checkoutUrl;
          ctx.expiresAt = session.expiresAt;
        },
        compensate: async (ctx) => {
          await provider.expireCheckoutSession(ctx.providerSessionId as string);
        },
      })
      .addStep({
        name: 'persistPaymentRecord',
        execute: async (ctx) => {
          await this.paymentRepository.create({
            invoiceId: ctx.params.invoiceId,
            provider: provider.name,
            providerSessionId: ctx.providerSessionId as string,
            status: 'pending',
            amount: ctx.params.amount,
            currency: ctx.params.currency,
            checkoutUrl: ctx.checkoutUrl as string,
            expiresAt: ctx.expiresAt as Date,
          });
        },
      });

    return this.runCheckoutSaga(saga, context);
  }

  /**
   * SSLCommerz: the record first, under our own tran_id, then the session. Its sessions can't be
   * closed from our side, so the session-first order would leave a payable session behind whenever
   * the record failed; this way every session that exists has a row, and a payment through it is
   * always settled (if the link can't be stored, the row is marked failed -- and a late payment on
   * a failed row is still settled).
   */
  private async createRecordedSession(provider: CheckoutProvider, params: CheckoutSessionParams): Promise<string> {
    const reference = this.providers.sslcommerz.newReference();
    const context: CreateCheckoutSagaContext = { params: { ...params, reference } };

    const saga = new Saga<CreateCheckoutSagaContext>('CreateRecordedCheckoutSession');
    saga
      .addStep({
        name: 'recordPayment',
        execute: async (ctx) => {
          const payment = await this.paymentRepository.create({
            invoiceId: ctx.params.invoiceId,
            provider: provider.name,
            providerSessionId: reference,
            status: 'pending',
            amount: ctx.params.amount,
            currency: ctx.params.currency,
          });
          ctx.paymentId = payment.id;
        },
        compensate: async (ctx) => {
          await this.paymentRepository.updateStatus(ctx.paymentId as string, 'failed');
        },
      })
      .addStep({
        name: 'createProviderSession',
        execute: async (ctx) => {
          const session = await provider.createCheckoutSession(ctx.params);
          ctx.checkoutUrl = session.checkoutUrl;
          ctx.expiresAt = session.expiresAt;
        },
      })
      .addStep({
        name: 'storeCheckoutLink',
        execute: async (ctx) => {
          await this.paymentRepository.setCheckout(
            ctx.paymentId as string,
            ctx.checkoutUrl as string,
            ctx.expiresAt as Date,
          );
        },
      });

    return this.runCheckoutSaga(saga, context);
  }

  private async runCheckoutSaga(
    saga: Saga<CreateCheckoutSagaContext>,
    context: CreateCheckoutSagaContext,
  ): Promise<string> {
    try {
      await saga.execute(context);
    } catch (error) {
      if (!(error instanceof SagaExecutionError)) throw error;

      // A concurrent request for the same invoice persisted its open session first (partial unique
      // index). Hand out the winner's link -- or, if it is still being created, ask for a retry.
      if (this.isUniqueViolation(error.cause)) {
        const winner = await this.paymentRepository.findOpenByInvoiceId(context.params.invoiceId);
        if (winner?.checkoutUrl) return winner.checkoutUrl;
        throw new ConflictException('A payment link for this invoice is being created; try again in a moment.');
      }
      throw this.providerError(error.cause);
    }
    return context.checkoutUrl as string;
  }

  /**
   * What this link collects: the balance due, or a part of it (partial payments). Within the
   * provider's per-payment limits -- SSLCommerz takes BDT 10 to 5,00,000, so a larger balance has to
   * be paid in parts (or by bank transfer).
   */
  private checkoutAmount(provider: CheckoutProvider, invoice: InvoiceResponse, requested?: number): number {
    const currency = invoice.currency as SupportedCurrency;
    const balanceMinor = toMinor(balanceDueOf(invoice), currency);
    if (balanceMinor <= 0) throw new ConflictException('Nothing is owed on this invoice.');

    let amountMinor = balanceMinor;
    if (requested !== undefined && requested !== null) {
      if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
        throw new BadRequestException('amount must be a positive number.');
      }
      try {
        amountMinor = toMinor(requested, currency);
      } catch (error) {
        throw new UnprocessableEntityException((error as Error).message);
      }
      if (amountMinor > balanceMinor) {
        throw new UnprocessableEntityException(
          `${formatMoney(amountMinor, currency)} is more than the balance due (${formatMoney(balanceMinor, currency)}).`,
        );
      }
    }

    const limits = provider.amountLimits(invoice.currency);
    if (limits && (amountMinor < limits.minMinor || amountMinor > limits.maxMinor)) {
      const name = provider.name === 'sslcommerz' ? 'SSLCommerz' : provider.name;
      throw new UnprocessableEntityException(
        `${name} takes ${formatMoney(limits.minMinor, currency)} to ${formatMoney(limits.maxMinor, currency)} per payment; ` +
          `${requested === undefined ? `the balance due is ${formatMoney(balanceMinor, currency)}` : `this is ${formatMoney(amountMinor, currency)}`}. ` +
          'Ask for a part of it (amount), or record a bank transfer.',
      );
    }
    return fromMinor(amountMinor, currency);
  }

  /** SSLCommerz failures as HTTP: its refusal is a gateway problem for the caller, an outage a 503. */
  private providerError(error: unknown): unknown {
    if (error instanceof SslCommerzRejectedError) return new BadGatewayException(error.message);
    if (error instanceof SslCommerzUnavailableError) return new ServiceUnavailableException(error.message);
    return error;
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

    // A webhook has no caller organization: act in the one the payment was started in, which is
    // what scopes invoice's MARK_PAID (and this service's own queries) to the right tenant.
    await runInOrganization(payment.organizationId, () =>
      this.applyWebhookEvent(event.type, payment, event.providerReference),
    );
  }

  private async applyWebhookEvent(
    type: WebhookEventType,
    payment: PaymentEntity,
    providerReference?: string,
  ): Promise<void> {
    if (type === 'payment_succeeded') {
      await this.settle(payment, { providerReference });
      return;
    }
    if (type === 'payment_failed' && payment.status === 'pending') {
      await this.paymentRepository.updateStatus(payment.id, 'failed');
    }
  }

  /**
   * A gateway confirmed the money for a checkout session: it goes into the ledger first (the record
   * of what happened -- idempotent per session), then onto the invoice.
   * - held (high risk): recorded, not counted on the invoice until a person accepts it;
   * - refused by invoice (it was cancelled meanwhile): recorded, flagged -- a refund is owed;
   * - overpaid (the invoice was already paid, e.g. through a session retired while the payer was on
   *   it): counted, flagged -- the excess is owed back;
   * - invoice unreachable: recorded; the ledger worker counts it later.
   */
  private async settle(
    payment: PaymentEntity,
    details: { providerReference?: string; held?: boolean; mismatchAmount?: number },
  ): Promise<void> {
    if (details.mismatchAmount !== undefined) {
      await this.ledger.recordGatewayPayment(payment, {
        providerReference: details.providerReference,
        amount: details.mismatchAmount,
        applyState: 'refused',
      });
      await this.paymentRepository.updateStatus(payment.id, 'reconciliation_required');
      return;
    }

    const entry = await this.ledger.recordGatewayPayment(payment, {
      providerReference: details.providerReference,
      applyState: details.held ? 'held' : 'pending',
    });
    if (entry.applyState === 'held') {
      await this.paymentRepository.updateStatus(payment.id, 'review_required');
      return;
    }
    if (entry.applyState === 'refused') {
      await this.paymentRepository.updateStatus(payment.id, 'reconciliation_required');
      return;
    }

    await this.paymentRepository.updateStatus(payment.id, 'paid');
    if (entry.applyState === 'applied') return;

    const applied = await this.ledger.apply(entry);
    if (applied.outcome === 'refused') {
      await this.paymentRepository.updateStatus(payment.id, 'reconciliation_required');
      return;
    }
    if (applied.outcome === 'applied' && applied.invoice.amountPaid > applied.invoice.total) {
      await this.paymentRepository.updateStatus(payment.id, 'reconciliation_required');
      this.logger.error(
        `Invoice "${payment.invoiceId}" is overpaid by ${(applied.invoice.amountPaid - applied.invoice.total).toFixed(2)} ${payment.currency} after payment "${payment.id}" -- flagged for reconciliation (refund the excess).`,
      );
      return;
    }
    this.logger.log(`Payment "${payment.id}" (${payment.provider}) settled for invoice "${payment.invoiceId}".`);
  }

  /**
   * SSLCommerz told us about a transaction (IPN), or the payer's browser came back to bff. Neither is
   * trusted: only the tran_id is used, to ask SSLCommerz -- with the organization's own credentials --
   * what actually happened (SslCommerzPaymentProvider.outcome). Idempotent: the IPN and the return
   * race each other and the IPN is retried, and a settled payment ignores both.
   *
   * A failure to reach SSLCommerz is a 503 for an IPN (so it is retried), but only "pending" for a
   * returning payer (the IPN, or the next return, settles it).
   */
  async handleSslCommerzNotification(notification: SslCommerzNotification): Promise<PaymentOutcome> {
    const tranId = notification?.tranId;
    if (typeof tranId !== 'string' || !TRAN_ID.test(tranId)) {
      throw new BadRequestException('A valid tran_id is required.');
    }

    // Unscoped, like the Stripe webhook's lookup: a notification carries no organization; the row says which.
    const payment = await this.paymentRepository.findByProviderSessionId(tranId);
    if (!payment || payment.provider !== 'sslcommerz') {
      this.logger.warn(`SSLCommerz ${notification.source} for unknown tran_id "${tranId}".`);
      return { status: 'unknown' };
    }

    return runInOrganization(payment.organizationId, async () => {
      try {
        return await this.settleSslCommerz(payment);
      } catch (error) {
        if (!(error instanceof SslCommerzUnavailableError || error instanceof SslCommerzRejectedError)) throw error;
        this.logger.error(
          `Could not ask SSLCommerz about tran_id "${tranId}" (${notification.source}): ${error.message}`,
        );
        if (notification.source === 'ipn') throw new ServiceUnavailableException(error.message);
        return { invoiceId: payment.invoiceId, status: 'pending' };
      }
    });
  }

  private async settleSslCommerz(payment: PaymentEntity): Promise<PaymentOutcome> {
    const outcome = (status: PaymentOutcome['status']): PaymentOutcome => ({ invoiceId: payment.invoiceId, status });
    if (SETTLED_STATUSES.includes(payment.status)) return outcome(payment.status as PaymentOutcome['status']);

    const result = await this.providers.sslcommerz.outcome(payment.providerSessionId);
    if (result.kind === 'pending') return outcome('pending');
    if (result.kind === 'failed') {
      if (payment.status === 'pending') await this.paymentRepository.updateStatus(payment.id, 'failed');
      return outcome('failed');
    }

    const { transaction } = result;
    const currency = payment.currency as SupportedCurrency;
    const paidMinor = minorOrNull(transaction.amount, currency);
    if (
      transaction.tranId !== payment.providerSessionId ||
      transaction.currency !== payment.currency ||
      paidMinor !== toMinor(payment.amount, currency)
    ) {
      // Money moved, but not for what we asked: recorded (as paid), never counted -- a human must look.
      await this.settle(payment, {
        providerReference: transaction.bankTranId,
        mismatchAmount: paidMinor === null ? payment.amount : fromMinor(paidMinor, currency),
      });
      this.logger.error(
        `SSLCommerz payment for tran_id "${payment.providerSessionId}" doesn't match its order: paid ${transaction.amount} ${transaction.currency} for ${transaction.tranId}, expected ${payment.amount} ${payment.currency} -- flagged for reconciliation.`,
      );
      return outcome('reconciliation_required');
    }
    if (transaction.riskLevel === '1') {
      await this.settle(payment, { providerReference: transaction.bankTranId, held: true });
      this.logger.error(
        `SSLCommerz flagged the payment for invoice "${payment.invoiceId}" (tran_id "${payment.providerSessionId}") as high risk ("${transaction.riskTitle}") -- held for review, invoice not marked paid.`,
      );
      return outcome('review_required');
    }
    if (transaction.discountAmount && Number(transaction.discountAmount) > 0) {
      this.logger.warn(
        `SSLCommerz applied a discount of ${transaction.discountAmount} ${transaction.currency} to tran_id "${payment.providerSessionId}"; the order amount matched.`,
      );
    }

    await this.settle(payment, { providerReference: transaction.bankTranId });
    const settled = await this.paymentRepository.findByProviderSessionId(payment.providerSessionId);
    return outcome((settled?.status ?? 'pending') as PaymentOutcome['status']);
  }

  /** Checkouts waiting for a person: held as high risk, or money that couldn't be settled on the invoice. */
  async listAttention(): Promise<AttentionPaymentResponse[]> {
    const rows = await this.paymentRepository.findByStatuses(['review_required', 'reconciliation_required']);
    return Promise.all(
      rows.map(async (row) => {
        const entry = await this.ledger.findForCheckout(row.id);
        return {
          paymentId: row.id,
          invoiceId: row.invoiceId,
          provider: row.provider,
          status: row.status as AttentionPaymentResponse['status'],
          amount: entry?.amount ?? row.amount,
          currency: row.currency,
          ...(entry ? { ledgerEntryId: entry.id } : {}),
          createdAt: row.createdAt,
        };
      }),
    );
  }

  /** A person accepts a payment held as high risk: it counts on the invoice now. */
  async acceptHeld(paymentId: string): Promise<PaymentOutcome> {
    const payment = await this.attentionPayment(paymentId, ['review_required']);
    const entry = await this.ledger.findForCheckout(payment.id);
    if (!entry || entry.applyState !== 'held') {
      throw new ConflictException(`Payment "${paymentId}" has no held ledger entry to accept.`);
    }
    const applied = await this.ledger.release(entry);
    if (applied.outcome === 'refused') {
      await this.paymentRepository.updateStatus(payment.id, 'reconciliation_required');
      return { invoiceId: payment.invoiceId, status: 'reconciliation_required' };
    }
    await this.paymentRepository.updateStatus(payment.id, 'paid');
    return { invoiceId: payment.invoiceId, status: applied.outcome === 'applied' ? 'paid' : 'pending' };
  }

  /**
   * A person refuses a held or unreconcilable payment: everything left of it is refunded through
   * its provider (LedgerService.refund), and the checkout is marked refunded.
   */
  async refuseHeld(paymentId: string, reason: string): Promise<LedgerEntryResponse> {
    const payment = await this.attentionPayment(paymentId, ['review_required', 'reconciliation_required']);
    const entry = await this.ledger.findForCheckout(payment.id);
    if (!entry) throw new ConflictException(`Payment "${paymentId}" has no ledger entry to refund.`);
    const remaining = await this.ledger.refundableMinor(entry);
    if (remaining <= 0) throw new ConflictException(`Payment "${paymentId}" has already been refunded.`);

    const refund = await this.ledger.refund(entry.invoiceId, {
      paymentEntryId: entry.id,
      amount: fromMinor(remaining, entry.currency as SupportedCurrency),
      reason: typeof reason === 'string' && reason.trim().length >= 3 ? reason : 'Payment refused after review.',
    });
    if (refund.state !== 'failed') await this.paymentRepository.updateStatus(payment.id, 'refunded');
    return refund;
  }

  private async attentionPayment(paymentId: string, statuses: PaymentStatus[]): Promise<PaymentEntity> {
    if (typeof paymentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(paymentId)) {
      throw new BadRequestException(`"${paymentId}" is not a payment id.`);
    }
    const payment = await this.paymentRepository.findById(paymentId);
    if (!payment) throw new NotFoundException(`Payment not found for id "${paymentId}".`);
    if (!statuses.includes(payment.status)) {
      throw new ConflictException(`Payment "${paymentId}" is ${payment.status}, not waiting for review.`);
    }
    return payment;
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
    const provider = this.providers.byName(payment.provider);
    if (provider.canExpireSessions) {
      await provider.expireCheckoutSession(payment.providerSessionId);
      await this.paymentRepository.updateStatus(payment.id, 'failed');
      return;
    }
    // Can't be closed (SSLCommerz): honestly "replaced", not "failed" -- it may still be paid through.
    await this.paymentRepository.updateStatus(payment.id, 'superseded');
  }

  private isUniqueViolation(error: unknown): boolean {
    return (error as { driverError?: { code?: string } } | null)?.driverError?.code === PG_UNIQUE_VIOLATION;
  }
}

/** SSLCommerz's decimal amount ("1380.50") in minor units, or null if it isn't one exactly. */
function minorOrNull(amount: string, currency: SupportedCurrency): number | null {
  const value = Number(amount);
  if (amount.trim() === '' || !Number.isFinite(value)) return null;
  try {
    return toMinor(value, currency);
  } catch {
    return null;
  }
}
