export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CheckoutSessionParams {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
}

export interface CheckoutSession {
  providerSessionId: string;
  checkoutUrl: string;
}

export type WebhookEventType = 'payment_succeeded' | 'payment_failed' | 'ignored';

export interface NormalizedWebhookEvent {
  type: WebhookEventType;
  providerSessionId?: string;
}

/**
 * Same "one small interface, one swappable class behind it" shape as StorageProvider
 * (apps/media/.../storage-provider.interface.ts) and PermissionResolver (libs/auth) --
 * StripePaymentProvider is the only implementation today, but nothing in PaymentService or
 * PaymentController knows that; adding PayPal/etc. later means adding a class and changing one
 * DI binding in PaymentModule, not touching a caller.
 */
export interface PaymentProvider {
  createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSession>;

  /** Verifies the provider's signature over the raw body -- throws if it doesn't match. */
  parseWebhookEvent(rawBody: Buffer, signature: string): NormalizedWebhookEvent;
}
