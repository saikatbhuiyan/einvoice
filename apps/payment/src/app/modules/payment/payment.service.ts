import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';
import { IPaymentRepository, PAYMENT_REPOSITORY } from './payment.repository.interface';
import { InvoiceClientService } from './invoice-client.service';

export interface CreateCheckoutSessionResponse {
  checkoutUrl: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    @Inject(PAYMENT_REPOSITORY) private readonly paymentRepository: IPaymentRepository,
    private readonly invoiceClient: InvoiceClientService,
  ) {}

  async createCheckoutSession(invoiceId: string): Promise<CreateCheckoutSessionResponse> {
    const invoice = await this.invoiceClient.findOneInvoice(invoiceId);

    const session = await this.paymentProvider.createCheckoutSession({
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.total,
      currency: invoice.currency,
    });

    await this.paymentRepository.create({
      invoiceId,
      provider: 'stripe',
      providerSessionId: session.providerSessionId,
      status: 'pending',
      amount: invoice.total,
      currency: invoice.currency,
      checkoutUrl: session.checkoutUrl,
    });

    return { checkoutUrl: session.checkoutUrl };
  }

  async handleWebhookEvent(rawBodyBase64: string, signature: string): Promise<void> {
    if (!signature) {
      throw new BadRequestException('Missing webhook signature.');
    }

    const rawBody = Buffer.from(rawBodyBase64, 'base64');
    const event = this.paymentProvider.parseWebhookEvent(rawBody, signature);

    if (event.type === 'ignored' || !event.providerSessionId) {
      return;
    }

    const payment = await this.paymentRepository.findByProviderSessionId(event.providerSessionId);
    if (!payment) {
      this.logger.warn(`No payment record found for provider session "${event.providerSessionId}".`);
      return;
    }

    if (event.type === 'payment_succeeded') {
      await this.paymentRepository.updateStatus(payment.id, 'paid');
      await this.invoiceClient.markInvoicePaid(payment.invoiceId);
      this.logger.log(`Invoice "${payment.invoiceId}" marked paid via Stripe session "${event.providerSessionId}".`);
      return;
    }

    if (event.type === 'payment_failed') {
      await this.paymentRepository.updateStatus(payment.id, 'failed');
    }
  }
}
