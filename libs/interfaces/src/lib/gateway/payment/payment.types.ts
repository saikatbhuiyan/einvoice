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

/** How money moved. Online methods are settled through a provider; the rest are recorded by a person. */
export const PAYMENT_METHODS = [
  'stripe',
  'sslcommerz',
  'bank_transfer',
  'cash',
  'cheque',
  'mobile_money',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods a person records by hand (money received or returned outside the gateways). */
export const MANUAL_PAYMENT_METHODS = ['bank_transfer', 'cash', 'cheque', 'mobile_money', 'other'] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export type LedgerEntryKind = 'payment' | 'refund';

/**
 * settled: money moved. pending: a provider refund still in progress. failed: it didn't happen.
 * unknown: the provider's answer was lost (SSLCommerz refunds can't be safely retried) -- a human
 * must check the provider's panel.
 */
export type LedgerEntryState = 'settled' | 'pending' | 'failed' | 'unknown';

/**
 * Whether an entry counts on the invoice: applied, pending (to be applied), held (high risk, until
 * accepted), refused (the invoice couldn't take it, e.g. it was cancelled -- a refund is owed), or
 * not_applicable (a refund of a payment that never counted on the invoice).
 */
export type LedgerApplyState = 'pending' | 'applied' | 'held' | 'refused' | 'not_applicable';

/** POST /invoices/:id/payment-link: a part of the balance, or (default) all of it. */
export interface CreatePaymentLinkRequest {
  amount?: number;
}

/** POST /invoices/:id/payments: money received outside the gateways. */
export interface RecordPaymentRequest {
  amount: number;
  method: ManualPaymentMethod;
  /** When the money was received (ISO date or date-time). */
  occurredAt: string;
  /** The bank's or payer's reference (transfer id, cheque number). */
  reference?: string;
  note?: string;
}

/** POST /invoices/:id/refunds: return money from one payment. */
export interface RefundRequest {
  paymentEntryId: string;
  amount: number;
  reason: string;
  /**
   * The money was already returned outside this system (the provider's dashboard, a bank transfer
   * back): only record it. Required for payments from before the ledger, which have no provider
   * reference to refund through.
   */
  returnedOutsideSystem?: boolean;
}

export interface LedgerEntryResponse {
  id: string;
  invoiceId: string;
  kind: LedgerEntryKind;
  method: PaymentMethod;
  amount: number;
  currency: string;
  state: LedgerEntryState;
  applyState: LedgerApplyState;
  /** For a refund: the payment it returns money from. */
  refundOfEntryId?: string;
  /** For a payment: how much of it has been refunded or is being refunded. */
  refundedAmount?: number;
  reference?: string;
  note?: string;
  failureReason?: string;
  occurredAt: string | Date;
  recordedBy?: string;
  createdAt: string | Date;
}

/** A checkout that needs a person: held as high risk, or money that couldn't be settled on the invoice. */
export interface AttentionPaymentResponse {
  paymentId: string;
  invoiceId: string;
  provider: string;
  status: 'review_required' | 'reconciliation_required';
  amount: number;
  currency: string;
  ledgerEntryId?: string;
  createdAt: string | Date;
}
