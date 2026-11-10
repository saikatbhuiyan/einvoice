import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { fromMinor, toMinor } from '@libs/money';
import type { SupportedCurrency } from '@libs/shared/types';
import { SSLCOMMERZ_OPTIONS, type SslCommerzOptions } from './sslcommerz.options';
import {
  RefundOutcomeUnknownError,
  type AmountLimits,
  type CheckoutProvider,
  type CheckoutSession,
  type CheckoutSessionParams,
  type ProviderRefund,
  type RefundParams,
} from '../payment-provider.interface';
import { ProviderCredentialsService } from '../credentials/provider-credentials.service';
import { SslCommerzClient, SslCommerzRejectedError, type ValidatedTransaction } from './sslcommerz.client';

/**
 * SSLCommerz documents no session lifetime and has no API to close one. A session is handed out
 * again for at most this long after creation (PaymentService reuses while > 30 min remain), then
 * superseded; a payment made through a superseded session is still settled.
 */
const ASSUMED_SESSION_LIFETIME_MS = 60 * 60 * 1000;

/** Documented per-transaction limits: BDT 10.00 to 5,00,000.00 (v4 docs; enforced on live stores). */
const BDT_LIMITS: AmountLimits = { minMinor: 1_000, maxMinor: 50_000_000 };

/** Attempt statuses that mean "this attempt ended without money moving". */
const ENDED_UNPAID = new Set(['FAILED', 'CANCELLED', 'EXPIRED', 'UNATTEMPTED']);

/** What SSLCommerz says happened to a transaction, asked by tran_id with the organization's credentials. */
export type SslCommerzOutcome =
  | { kind: 'paid'; transaction: ValidatedTransaction }
  | { kind: 'pending' }
  | { kind: 'failed' };

/**
 * An organization's own SSLCommerz store (cards, bKash, Nagad, Rocket, internet banking on one
 * hosted page). Credentials come from ProviderCredentialsService for the current organization, so
 * every call must run inside that organization's context.
 */
@Injectable()
export class SslCommerzPaymentProvider implements CheckoutProvider {
  readonly name = 'sslcommerz' as const;
  readonly canExpireSessions = false;
  /** A repeated refund_trans_id creates a second refund (probed): never retried automatically. */
  readonly refundsAreIdempotent = false;

  constructor(
    private readonly credentials: ProviderCredentialsService,
    private readonly client: SslCommerzClient,
    @Inject(SSLCOMMERZ_OPTIONS) private readonly options: SslCommerzOptions,
  ) {}

  /** SSLCommerz settles in BDT; other currencies would be converted at its rate, so only BDT is routed here. */
  amountLimits(currency: string): AmountLimits | null {
    return currency === 'BDT' ? BDT_LIMITS : null;
  }

  /**
   * tran_id: ours, 30 characters (SSLCommerz's maximum), random -- recorded on the payment row
   * before the session exists, so no session can exist that we have no record of.
   */
  newReference(): string {
    return `einv${randomBytes(13).toString('hex')}`;
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSession> {
    if (!params.reference) throw new Error('An SSLCommerz checkout needs its tran_id (reference).');
    const base = this.options.publicBaseUrl;
    if (!base) {
      throw new ServiceUnavailableException(
        'SSLCommerz is not set up on this server (PAYMENT_PUBLIC_BASE_URL is missing).',
      );
    }
    const currency = params.currency as SupportedCurrency;
    const session = await this.client.createSession(await this.credentials.resolveSslCommerz(), {
      tranId: params.reference,
      totalAmount: fromMinor(toMinor(params.amount, currency), currency).toFixed(2),
      currency: params.currency,
      successUrl: `${base}/payments/sslcommerz/return/success`,
      failUrl: `${base}/payments/sslcommerz/return/fail`,
      cancelUrl: `${base}/payments/sslcommerz/return/cancel`,
      ipnUrl: `${base}/payments/sslcommerz/ipn`,
      productName: `Invoice ${params.invoiceNumber}`,
      customer: params.customer,
      valueA: params.invoiceId,
    });
    return {
      providerSessionId: params.reference,
      checkoutUrl: session.gatewayUrl,
      expiresAt: new Date(Date.now() + ASSUMED_SESSION_LIFETIME_MS),
    };
  }

  /**
   * Starts a refund against the payment's bank_tran_id. "success" from SSLCommerz means accepted:
   * the refund is pending until its status says refunded. An outage here is an unknown outcome --
   * the refund may have been made -- and SSLCommerz refunds can't be safely retried.
   */
  async refund(params: RefundParams): Promise<ProviderRefund> {
    let credentials;
    try {
      credentials = await this.credentials.resolveSslCommerz({ forSettlement: true });
    } catch (error) {
      // Nothing was sent, so nothing was refunded. Failing it (rather than leaving it pending, which
      // is never retried for SSLCommerz) lets the refund simply be asked for again.
      return { state: 'failed', failureReason: `Refund not sent: ${(error as Error).message}` };
    }
    const currency = params.currency as SupportedCurrency;
    let answer;
    try {
      answer = await this.client.refund(credentials, {
        bankTranId: params.paymentReference,
        // Their documented maximum is 30 characters; our entry id without dashes is 32.
        refundTransId: `r${params.refundId.replace(/-/g, '').slice(0, 29)}`,
        amount: fromMinor(toMinor(params.amount, currency), currency).toFixed(2),
        remarks: params.reason.slice(0, 255),
      });
    } catch (error) {
      if (error instanceof SslCommerzRejectedError) return { state: 'failed', failureReason: error.message };
      throw new RefundOutcomeUnknownError(`SSLCommerz refund outcome unknown: ${(error as Error).message}`);
    }
    if (answer.status === 'success' || answer.status === 'processing') {
      return { state: 'pending', providerReference: answer.refundRefId };
    }
    return { state: 'failed', failureReason: answer.errorReason || `SSLCommerz refund ${answer.status || 'failed'}.` };
  }

  async refundStatus(providerReference: string): Promise<ProviderRefund> {
    let answer;
    try {
      const credentials = await this.credentials.resolveSslCommerz({ forSettlement: true });
      answer = await this.client.refundStatus(credentials, providerReference);
    } catch (error) {
      throw new RefundOutcomeUnknownError(`SSLCommerz refund status unknown: ${(error as Error).message}`);
    }
    if (answer.status === 'refunded') return { state: 'settled', providerReference };
    if (answer.status === 'processing') return { state: 'pending', providerReference };
    return {
      state: 'failed',
      providerReference,
      failureReason: answer.errorReason || `SSLCommerz refund ${answer.status || 'failed'}.`,
    };
  }

  /** SSLCommerz has no way to close a session; PaymentService supersedes it locally instead. */
  async expireCheckoutSession(): Promise<void> {
    return;
  }

  /**
   * The trust anchor for every SSLCommerz notification: whatever an IPN or a returning browser
   * claims, ask SSLCommerz by tran_id, and validate the successful attempt's val_id (which also
   * marks it validated there).
   */
  async outcome(tranId: string): Promise<SslCommerzOutcome> {
    const credentials = await this.credentials.resolveSslCommerz({ forSettlement: true });
    const attempts = await this.client.queryTransaction(credentials, tranId);

    const succeeded = attempts.find((attempt) => ['VALID', 'VALIDATED'].includes(attempt.status) && attempt.valId);
    if (succeeded) {
      const transaction = await this.client.validate(credentials, succeeded.valId);
      if (['VALID', 'VALIDATED'].includes(transaction.status)) return { kind: 'paid', transaction };
    }
    if (attempts.length > 0 && attempts.every((attempt) => ENDED_UNPAID.has(attempt.status))) {
      return { kind: 'failed' };
    }
    // Still on SSLCommerz's page, processing, or unknown to it yet.
    return { kind: 'pending' };
  }
}
