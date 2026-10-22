import Stripe from 'stripe';
import { exponentOf } from '@libs/money';
import { SUPPORTED_CURRENCIES } from '@libs/shared/types';

const WEBHOOK_SECRET = 'whsec_test_secret';
const CUSTOMER = { name: 'Acme Corp', email: 'billing@acme.test' };

jest.mock('../../../configuration', () => ({
  CONFIGURATION: {
    STRIPE_CONFIG: {
      STRIPE_SECRET_KEY: 'sk_test_unit',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
      STRIPE_SUCCESS_URL: 'https://app.test/paid',
      STRIPE_CANCEL_URL: 'https://app.test/cancelled',
    },
  },
}));

import { StripePaymentProvider } from './stripe-payment.provider';

const stripeFor = (provider: StripePaymentProvider) => (provider as unknown as { stripe: Stripe }).stripe;

// Signs a payload exactly the way Stripe does, so constructEvent runs its real HMAC check.
function signedWebhook(event: object, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const signature = new Stripe('sk_test_unit').webhooks.generateTestHeaderString({ payload, secret });
  return { rawBody: Buffer.from(payload), signature };
}

const sessionEvent = (type: string, id = 'cs_test_123') => ({
  id: 'evt_1',
  object: 'event',
  type,
  data: { object: { id, object: 'checkout.session' } },
});

describe('StripePaymentProvider', () => {
  let provider: StripePaymentProvider;

  beforeEach(() => {
    provider = new StripePaymentProvider();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('parseWebhookEvent (real signature verification)', () => {
    it('maps checkout.session.completed to payment_succeeded', () => {
      const { rawBody, signature } = signedWebhook(sessionEvent('checkout.session.completed'));

      expect(provider.parseWebhookEvent(rawBody, signature)).toEqual({
        type: 'payment_succeeded',
        providerSessionId: 'cs_test_123',
      });
    });

    it('maps checkout.session.expired to payment_failed', () => {
      const { rawBody, signature } = signedWebhook(sessionEvent('checkout.session.expired'));

      expect(provider.parseWebhookEvent(rawBody, signature).type).toBe('payment_failed');
    });

    it('ignores event types it does not handle, without failing the webhook', () => {
      const { rawBody, signature } = signedWebhook(sessionEvent('customer.created'));

      expect(provider.parseWebhookEvent(rawBody, signature)).toEqual({ type: 'ignored' });
    });

    it('rejects a payload signed with a different secret', () => {
      const { rawBody, signature } = signedWebhook(sessionEvent('checkout.session.completed'), 'whsec_attacker');

      expect(() => provider.parseWebhookEvent(rawBody, signature)).toThrow(
        Stripe.errors.StripeSignatureVerificationError,
      );
    });

    // Why bff must relay the *raw* bytes: any re-serialization (even key order or whitespace)
    // changes the HMAC input.
    it('rejects a body that was re-serialized after signing', () => {
      const { rawBody, signature } = signedWebhook(sessionEvent('checkout.session.completed'));
      const reserialized = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString()), null, 2));

      expect(() => provider.parseWebhookEvent(reserialized, signature)).toThrow(
        Stripe.errors.StripeSignatureVerificationError,
      );
    });

    it('rejects a missing signature header', () => {
      const { rawBody } = signedWebhook(sessionEvent('checkout.session.completed'));

      expect(() => provider.parseWebhookEvent(rawBody, '')).toThrow();
    });
  });

  describe('createCheckoutSession', () => {
    it('charges the invoice total in minor units and tags the session with the invoice id', async () => {
      const create = jest
        .spyOn(stripeFor(provider).checkout.sessions, 'create')
        .mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1', expires_at: 1792000000 } as never);

      const session = await provider.createCheckoutSession({
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-1',
        amount: 129.9,
        currency: 'EUR',
        customer: CUSTOMER,
      });

      expect(session).toEqual({
        providerSessionId: 'cs_1',
        checkoutUrl: 'https://checkout.stripe.test/cs_1',
        // Stripe's expires_at is Unix seconds.
        expiresAt: new Date(1792000000 * 1000),
      });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          metadata: { invoiceId: 'inv-1' },
          success_url: 'https://app.test/paid',
          line_items: [
            expect.objectContaining({
              quantity: 1,
              price_data: expect.objectContaining({ currency: 'eur', unit_amount: 12990 }),
            }),
          ],
        }),
      );
    });

    // Invoice totals are exact minor units turned into decimals; this guards that converting back
    // can't produce a fractional amount Stripe rejects.
    it('sends an integer minor-unit amount even when the total carries float noise', async () => {
      const create = jest
        .spyOn(stripeFor(provider).checkout.sessions, 'create')
        .mockResolvedValue({ id: 'cs_1', url: 'u' } as never);

      await provider.createCheckoutSession({
        invoiceId: 'i',
        invoiceNumber: 'n',
        amount: 0.1 + 0.2,
        currency: 'USD',
        customer: CUSTOMER,
      });

      expect(create.mock.calls[0][0]?.line_items?.[0].price_data?.unit_amount).toBe(30);
    });

    it('charges BDT in poisha and refuses an amount finer than the currency allows', async () => {
      const create = jest
        .spyOn(stripeFor(provider).checkout.sessions, 'create')
        .mockResolvedValue({ id: 'cs_1', url: 'u' } as never);

      await provider.createCheckoutSession({
        invoiceId: 'i',
        invoiceNumber: 'n',
        amount: 1_380_000.5,
        currency: 'BDT',
        customer: CUSTOMER,
      });
      expect(create.mock.calls[0][0]?.line_items?.[0].price_data?.unit_amount).toBe(138_000_050);

      await expect(
        provider.createCheckoutSession({
          invoiceId: 'i',
          invoiceNumber: 'n',
          amount: 1.005,
          currency: 'BDT',
          customer: CUSTOMER,
        }),
      ).rejects.toThrow('1.005 BDT has more than 2 decimal places.');
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('fails loudly when Stripe returns a session without a URL', async () => {
      jest.spyOn(stripeFor(provider).checkout.sessions, 'create').mockResolvedValue({ id: 'cs_9', url: null } as never);

      await expect(
        provider.createCheckoutSession({
          invoiceId: 'i',
          invoiceNumber: 'n',
          amount: 1,
          currency: 'USD',
          customer: CUSTOMER,
        }),
      ).rejects.toThrow('Stripe did not return a checkout URL for session "cs_9".');
    });
  });

  describe('expireCheckoutSession (saga compensation)', () => {
    it('treats an already-completed/expired session as nothing to undo', async () => {
      jest
        .spyOn(stripeFor(provider).checkout.sessions, 'expire')
        .mockRejectedValue(
          new Stripe.errors.StripeInvalidRequestError({ message: 'already expired', type: 'invalid_request_error' }),
        );

      await expect(provider.expireCheckoutSession('cs_1')).resolves.toBeUndefined();
    });

    it('rethrows anything else so the saga records a compensation failure', async () => {
      jest
        .spyOn(stripeFor(provider).checkout.sessions, 'expire')
        .mockRejectedValue(new Stripe.errors.StripeConnectionError({ message: 'ECONNRESET', type: 'api_error' }));

      await expect(provider.expireCheckoutSession('cs_1')).rejects.toBeInstanceOf(Stripe.errors.StripeConnectionError);
    });
  });

  // Tripwire: unit_amount uses the ISO 4217 exponent (@libs/money). Stripe agrees with ISO for
  // two-decimal currencies; its zero-decimal ones (JPY, KRW, ...) take whole units, and a few
  // (ISK, HUF, TWD, UGX) and the three-decimal ones have their own rules. Adding such a currency
  // needs a look at Stripe's docs, not just an exponent.
  it('only supports currencies whose Stripe minor unit is the ISO exponent of 2', () => {
    const zeroDecimal = [
      'BIF',
      'CLP',
      'DJF',
      'GNF',
      'JPY',
      'KMF',
      'KRW',
      'MGA',
      'PYG',
      'RWF',
      'UGX',
      'VND',
      'VUV',
      'XAF',
      'XOF',
      'XPF',
    ];

    expect(SUPPORTED_CURRENCIES.filter((currency) => zeroDecimal.includes(currency))).toEqual([]);
    expect(SUPPORTED_CURRENCIES.map((currency) => exponentOf(currency))).toEqual(SUPPORTED_CURRENCIES.map(() => 2));
  });
});
