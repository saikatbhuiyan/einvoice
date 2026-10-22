/** Payment providers an organization can take money through. Stripe is the platform's; SSLCommerz is per organization. */
export const PAYMENT_PROVIDERS = ['stripe', 'sslcommerz'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

/** An organization connecting its own SSLCommerz store. The password is write-only: never returned. */
export interface SslCommerzCredentialsRequest {
  storeId: string;
  storePassword: string;
  /** true: sandbox.sslcommerz.com (testing); false: securepay.sslcommerz.com (real money). */
  sandbox: boolean;
}

/** What is visible about a connected store: never the password. */
export interface SslCommerzCredentialsResponse {
  provider: 'sslcommerz';
  storeId: string;
  sandbox: boolean;
  configuredAt: string | Date;
}

export interface CreateCheckoutSessionResponse {
  checkoutUrl: string;
  provider: PaymentProviderName;
}

/**
 * SSLCommerz told us (IPN) or the payer's browser came back (return redirect) about a transaction.
 * Only `tranId` is acted on: payment asks SSLCommerz itself what happened, with the organization's
 * own credentials, and trusts nothing else in the notification.
 */
export interface SslCommerzNotification {
  tranId: string;
  /** Where it came from, for logs: 'ipn' | 'success' | 'fail' | 'cancel'. */
  source: string;
}

/** What settling a transaction found, for the payer's return page. */
export interface PaymentOutcome {
  invoiceId?: string;
  status: 'paid' | 'pending' | 'failed' | 'review_required' | 'reconciliation_required' | 'unknown';
}
