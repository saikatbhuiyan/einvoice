import { Inject, Injectable } from '@nestjs/common';
import type { PaymentProviderName } from '@libs/interfaces/gateway';
import { PAYMENT_PROVIDER, type CheckoutProvider, type PaymentProvider } from './payment-provider.interface';
import { SslCommerzPaymentProvider } from './sslcommerz/sslcommerz-payment.provider';
import { ProviderCredentialsService } from './credentials/provider-credentials.service';

/**
 * Which provider takes an invoice's payment: SSLCommerz for a BDT invoice when the organization has
 * connected its store (Stripe doesn't onboard Bangladeshi merchants), Stripe for everything else.
 */
@Injectable()
export class PaymentProviderRegistry {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly stripe: PaymentProvider,
    readonly sslcommerz: SslCommerzPaymentProvider,
    private readonly credentials: ProviderCredentialsService,
  ) {}

  /** Must run in the invoice's organization: it checks that organization's connected store. */
  async forCheckout(currency: string): Promise<CheckoutProvider> {
    if (currency === 'BDT' && (await this.credentials.hasSslCommerz())) return this.sslcommerz;
    return this.stripe;
  }

  /** The provider an existing payment row was created with. */
  byName(name: string): CheckoutProvider {
    const provider = (
      { stripe: this.stripe, sslcommerz: this.sslcommerz } as Record<PaymentProviderName, CheckoutProvider>
    )[name as PaymentProviderName];
    if (!provider) throw new Error(`Unknown payment provider "${name}".`);
    return provider;
  }
}
