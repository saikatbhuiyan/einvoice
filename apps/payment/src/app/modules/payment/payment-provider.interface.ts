import type { PaymentProviderName } from '@libs/interfaces/gateway';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CheckoutSessionParams {
  /**
   * Our own reference for the session, when the provider takes one (SSLCommerz's tran_id). Unique,
   * and recorded on the payment row *before* the session exists -- see PaymentService.
   */
  reference?: string;
  invoiceId: string;
  invoiceNumber: string;
  /** The invoice total as a decimal in `currency` (the API shape); providers convert as they need. */
  amount: number;
  currency: string;
  customer: { name: string; email: string; phone?: string; address?: string };
}

export interface CheckoutSession {
  providerSessionId: string;
  checkoutUrl: string;
  /** After this the session can no longer be paid through; PaymentService reuses it until shortly before. */
  expiresAt: Date;
}

export type WebhookEventType = 'payment_succeeded' | 'payment_failed' | 'ignored';

export interface NormalizedWebhookEvent {
  type: WebhookEventType;
  providerSessionId?: string;
  /** What a refund of this payment is made against (Stripe's payment_intent). */
  providerReference?: string;
}

export interface RefundParams {
  /** The payment's provider reference (Stripe payment_intent, SSLCommerz bank_tran_id). */
  paymentReference: string;
  /** Decimal, in `currency`. */
  amount: number;
  currency: string;
  /** Our refund ledger entry's id: Stripe's idempotency key, SSLCommerz's refund_trans_id. */
  refundId: string;
  reason: string;
}

/** Where a refund stands at the provider. */
export interface ProviderRefund {
  state: 'settled' | 'pending' | 'failed';
  /** The provider's refund id, to ask about it later (Stripe re_…, SSLCommerz refund_ref_id). */
  providerReference?: string;
  failureReason?: string;
}

/**
 * The refund call's outcome is unknown (a timeout, an outage) -- it may or may not have been made.
 * Only safe to retry when the provider de-duplicates refunds (refundsAreIdempotent).
 */
export class RefundOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundOutcomeUnknownError';
  }
}

/** The smallest and largest amount one checkout may take, in minor units. */
export interface AmountLimits {
  minMinor: number;
  maxMinor: number;
}

/**
 * What every provider can do for a checkout. Same "one small interface, swappable classes behind
 * it" shape as StorageProvider and PermissionResolver; PaymentProviderRegistry picks one per
 * checkout (by currency and what the organization has connected).
 */
export interface CheckoutProvider {
  readonly name: PaymentProviderName;

  /**
   * Whether a session can be closed from our side. Stripe's can; SSLCommerz's can't (no API), so a
   * retired SSLCommerz session is only superseded locally and can still be paid through -- which
   * settlement then handles like any other payment.
   */
  readonly canExpireSessions: boolean;

  /** Per-checkout limits for `currency`, or null if the provider has none. */
  amountLimits(currency: string): AmountLimits | null;

  createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSession>;

  /**
   * Compensating action for createCheckoutSession, and how a nearly-expired session is retired.
   * Expiring a session that is already complete or expired is a no-op; so is any call on a
   * provider that can't expire sessions.
   */
  expireCheckoutSession(providerSessionId: string): Promise<void>;

  /**
   * Whether a refund call can be repeated after an unknown outcome without refunding twice. Stripe:
   * yes (idempotency keys). SSLCommerz: no -- a repeated refund_trans_id creates a second refund
   * (probed), so an unknown outcome is left for a human.
   */
  readonly refundsAreIdempotent: boolean;

  /** Starts a refund. Throws RefundOutcomeUnknownError when it can't tell whether it was made. */
  refund(params: RefundParams): Promise<ProviderRefund>;

  /** Where a refund started earlier stands. */
  refundStatus(providerReference: string): Promise<ProviderRefund>;
}

/** Stripe: the platform's own account, confirmed by signed webhooks. */
export interface PaymentProvider extends CheckoutProvider {
  /** Verifies the provider's signature over the raw body -- throws if it doesn't match. */
  parseWebhookEvent(rawBody: Buffer, signature: string): NormalizedWebhookEvent;
}
