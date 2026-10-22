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
}

/** Stripe: the platform's own account, confirmed by signed webhooks. */
export interface PaymentProvider extends CheckoutProvider {
  /** Verifies the provider's signature over the raw body -- throws if it doesn't match. */
  parseWebhookEvent(rawBody: Buffer, signature: string): NormalizedWebhookEvent;
}
