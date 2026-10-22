import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import type { SupportedCurrency } from '@libs/shared/types';
import { toMinor } from '@libs/money';
import { CONFIGURATION } from '../../../configuration';
import {
  CheckoutSession,
  CheckoutSessionParams,
  NormalizedWebhookEvent,
  PaymentProvider,
} from './payment-provider.interface';

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  readonly canExpireSessions = true;
  private readonly stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(CONFIGURATION.STRIPE_CONFIG.STRIPE_SECRET_KEY);
  }

  /** Stripe's per-checkout limits vary by currency and account; none is enforced here. */
  amountLimits(): null {
    return null;
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSession> {
    const config = CONFIGURATION.STRIPE_CONFIG;

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            product_data: { name: `Invoice ${params.invoiceNumber}` },
            // Stripe amounts are in the currency's smallest unit, by its ISO 4217 exponent (poisha,
            // cents). toMinor refuses an amount with more decimals than the currency has.
            unit_amount: toMinor(params.amount, params.currency as SupportedCurrency),
          },
          quantity: 1,
        },
      ],
      success_url: config.STRIPE_SUCCESS_URL,
      cancel_url: config.STRIPE_CANCEL_URL,
      metadata: { invoiceId: params.invoiceId },
    });

    if (!session.url) {
      throw new Error(`Stripe did not return a checkout URL for session "${session.id}".`);
    }

    // expires_at is always set (Stripe's default is 24h after creation), in Unix seconds.
    return { providerSessionId: session.id, checkoutUrl: session.url, expiresAt: new Date(session.expires_at * 1000) };
  }

  async expireCheckoutSession(providerSessionId: string): Promise<void> {
    // Expiring an already-completed/already-expired session is a 400 from Stripe, not a no-op.
    // Both callers (saga compensation, retiring a nearly-expired session) want "this session can't
    // be paid through any more", which an already-completed or -expired session already satisfies --
    // a completed one's webhook still marks the invoice paid as normal.
    try {
      await this.stripe.checkout.sessions.expire(providerSessionId);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        return;
      }
      throw error;
    }
  }

  parseWebhookEvent(rawBody: Buffer, signature: string): NormalizedWebhookEvent {
    // constructEvent verifies the signature itself -- the webhook secret never leaves this
    // service; bff, which actually receives the HTTP request, never sees or needs it.
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      CONFIGURATION.STRIPE_CONFIG.STRIPE_WEBHOOK_SECRET,
    );

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        return { type: 'payment_succeeded', providerSessionId: session.id };
      }
      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session;
        return { type: 'payment_failed', providerSessionId: session.id };
      }
      default:
        return { type: 'ignored' };
    }
  }
}
