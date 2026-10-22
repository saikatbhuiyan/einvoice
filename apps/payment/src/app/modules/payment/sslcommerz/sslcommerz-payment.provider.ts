import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { fromMinor, toMinor } from '@libs/money';
import type { SupportedCurrency } from '@libs/shared/types';
import { SSLCOMMERZ_OPTIONS, type SslCommerzOptions } from './sslcommerz.options';
import type {
  AmountLimits,
  CheckoutProvider,
  CheckoutSession,
  CheckoutSessionParams,
} from '../payment-provider.interface';
import { ProviderCredentialsService } from '../credentials/provider-credentials.service';
import { SslCommerzClient, type ValidatedTransaction } from './sslcommerz.client';

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
