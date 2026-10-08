import { PaymentService } from './payment.service';
import { PaymentEntity } from '../../../database/entities/payment.entity';

type MockPaymentProvider = {
  createCheckoutSession: jest.Mock;
  expireCheckoutSession: jest.Mock;
  parseWebhookEvent: jest.Mock;
};
type MockPaymentRepository = {
  create: jest.Mock;
  findByProviderSessionId: jest.Mock;
  updateStatus: jest.Mock;
};
type MockInvoiceClient = { findOneInvoice: jest.Mock; markInvoicePaid: jest.Mock };

const buildPayment = (overrides: Partial<PaymentEntity> = {}): PaymentEntity =>
  ({
    id: 'payment-1',
    invoiceId: 'invoice-1',
    provider: 'stripe',
    providerSessionId: 'cs_test_123',
    status: 'pending',
    amount: 100,
    currency: 'USD',
    checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as PaymentEntity;

describe('PaymentService', () => {
  let paymentProvider: MockPaymentProvider;
  let paymentRepository: MockPaymentRepository;
  let invoiceClient: MockInvoiceClient;
  let service: PaymentService;

  beforeEach(() => {
    paymentProvider = {
      createCheckoutSession: jest.fn(),
      expireCheckoutSession: jest.fn().mockResolvedValue(undefined),
      parseWebhookEvent: jest.fn(),
    };
    paymentRepository = {
      create: jest.fn(),
      findByProviderSessionId: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    invoiceClient = { findOneInvoice: jest.fn(), markInvoicePaid: jest.fn() };

    service = new PaymentService(paymentProvider as never, paymentRepository as never, invoiceClient as never);
  });

  describe('createCheckoutSession', () => {
    it('creates the Stripe session then persists the local record on the happy path', async () => {
      invoiceClient.findOneInvoice.mockResolvedValue({ invoiceNumber: 'INV-0001', total: 220, currency: 'USD' });
      paymentProvider.createCheckoutSession.mockResolvedValue({
        providerSessionId: 'cs_test_123',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
      });
      paymentRepository.create.mockResolvedValue(buildPayment());

      const result = await service.createCheckoutSession('invoice-1');

      expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123' });
      expect(paymentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceId: 'invoice-1', providerSessionId: 'cs_test_123', status: 'pending' }),
      );
      expect(paymentProvider.expireCheckoutSession).not.toHaveBeenCalled();
    });

    it('expires the Stripe session if persisting the local record fails -- closing the orphaned-session gap', async () => {
      invoiceClient.findOneInvoice.mockResolvedValue({ invoiceNumber: 'INV-0001', total: 220, currency: 'USD' });
      paymentProvider.createCheckoutSession.mockResolvedValue({
        providerSessionId: 'cs_test_123',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
      });
      const persistError = new Error('DB unavailable');
      paymentRepository.create.mockRejectedValue(persistError);

      await expect(service.createCheckoutSession('invoice-1')).rejects.toThrow();

      expect(paymentProvider.expireCheckoutSession).toHaveBeenCalledWith('cs_test_123');
    });
  });

  describe('handleWebhookEvent', () => {
    it('marks the payment and the invoice paid on a successful payment event', async () => {
      paymentProvider.parseWebhookEvent.mockReturnValue({
        type: 'payment_succeeded',
        providerSessionId: 'cs_test_123',
      });
      paymentRepository.findByProviderSessionId.mockResolvedValue(buildPayment());
      invoiceClient.markInvoicePaid.mockResolvedValue(undefined);

      await service.handleWebhookEvent(Buffer.from('{}').toString('base64'), 'sig');

      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-1', 'paid');
      expect(invoiceClient.markInvoicePaid).toHaveBeenCalledWith('invoice-1');
    });

    it('flags the payment for reconciliation if marking the invoice paid fails, rather than reverting to pending or staying silently paid', async () => {
      paymentProvider.parseWebhookEvent.mockReturnValue({
        type: 'payment_succeeded',
        providerSessionId: 'cs_test_123',
      });
      paymentRepository.findByProviderSessionId.mockResolvedValue(buildPayment());
      const invoiceError = new Error('invoice service unreachable');
      invoiceClient.markInvoicePaid.mockRejectedValue(invoiceError);

      await expect(service.handleWebhookEvent(Buffer.from('{}').toString('base64'), 'sig')).rejects.toThrow(
        'invoice service unreachable',
      );

      expect(paymentRepository.updateStatus).toHaveBeenNthCalledWith(1, 'payment-1', 'paid');
      expect(paymentRepository.updateStatus).toHaveBeenNthCalledWith(2, 'payment-1', 'reconciliation_required');
    });

    it('does nothing for an ignored event type', async () => {
      paymentProvider.parseWebhookEvent.mockReturnValue({ type: 'ignored' });

      await service.handleWebhookEvent(Buffer.from('{}').toString('base64'), 'sig');

      expect(paymentRepository.findByProviderSessionId).not.toHaveBeenCalled();
    });

    it('throws when the signature header is missing', async () => {
      await expect(service.handleWebhookEvent(Buffer.from('{}').toString('base64'), '')).rejects.toThrow(
        'Missing webhook signature.',
      );
    });
  });
});
