import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { CONFIGURATION } from '../../../configuration';
import {
  CheckoutSession,
  CheckoutSessionParams,
  NormalizedWebhookEvent,
  PaymentProvider,
} from './payment-provider.interface';

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  private readonly stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(CONFIGURATION.STRIPE_CONFIG.STRIPE_SECRET_KEY);
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
            // Stripe amounts are in the currency's smallest unit (cents for USD/EUR, etc.).
            unit_amount: Math.round(params.amount * 100),
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

    return { providerSessionId: session.id, checkoutUrl: session.url };
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
