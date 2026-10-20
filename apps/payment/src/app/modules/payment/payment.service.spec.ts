import { ConflictException, HttpException } from '@nestjs/common';
import { getCurrentCorrelationContext } from '@libs/logging/correlation-context';
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
  findOpenByInvoiceId: jest.Mock;
  hasOtherPaidPayment: jest.Mock;
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
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as PaymentEntity;

const ISSUED_INVOICE = { invoiceNumber: 'INV-0001', total: 220, currency: 'USD', status: 'issued' };

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
      findOpenByInvoiceId: jest.fn().mockResolvedValue(null),
      hasOtherPaidPayment: jest.fn().mockResolvedValue(false),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    invoiceClient = { findOneInvoice: jest.fn(), markInvoicePaid: jest.fn() };

    service = new PaymentService(paymentProvider as never, paymentRepository as never, invoiceClient as never);
  });

  describe('createCheckoutSession', () => {
    it('creates the Stripe session then persists the local record on the happy path', async () => {
      invoiceClient.findOneInvoice.mockResolvedValue(ISSUED_INVOICE);
      paymentProvider.createCheckoutSession.mockResolvedValue({
        providerSessionId: 'cs_test_123',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        expiresAt: new Date('2026-10-20T12:00:00.000Z'),
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
      invoiceClient.findOneInvoice.mockResolvedValue(ISSUED_INVOICE);
      paymentProvider.createCheckoutSession.mockResolvedValue({
        providerSessionId: 'cs_test_123',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        expiresAt: new Date('2026-10-20T12:00:00.000Z'),
      });
      const persistError = new Error('DB unavailable');
      paymentRepository.create.mockRejectedValue(persistError);

      await expect(service.createCheckoutSession('invoice-1')).rejects.toBe(persistError);

      expect(paymentProvider.expireCheckoutSession).toHaveBeenCalledWith('cs_test_123');
    });

    it('records when the session expires', async () => {
      invoiceClient.findOneInvoice.mockResolvedValue(ISSUED_INVOICE);
      paymentProvider.createCheckoutSession.mockResolvedValue({
        providerSessionId: 'cs_new',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_new',
        expiresAt: new Date('2026-10-20T12:00:00.000Z'),
      });

      await service.createCheckoutSession('invoice-1');

      expect(paymentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: new Date('2026-10-20T12:00:00.000Z') }),
      );
    });

    it.each(['draft', 'paid', 'cancelled'])('refuses to take payment for a %s invoice', async (status) => {
      invoiceClient.findOneInvoice.mockResolvedValue({ ...ISSUED_INVOICE, status });

      await expect(service.createCheckoutSession('invoice-1')).rejects.toThrow(
        new ConflictException(`Cannot take payment for an invoice that is ${status}.`),
      );
      expect(paymentProvider.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('accepts an overdue invoice', async () => {
      invoiceClient.findOneInvoice.mockResolvedValue({ ...ISSUED_INVOICE, status: 'overdue' });
      paymentProvider.createCheckoutSession.mockResolvedValue({
        providerSessionId: 'cs_new',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_new',
        expiresAt: new Date('2026-10-20T12:00:00.000Z'),
      });

      await expect(service.createCheckoutSession('invoice-1')).resolves.toEqual({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_new',
      });
    });

    it('hands out the open session again instead of creating a second payable one', async () => {
      invoiceClient.findOneInvoice.mockResolvedValue(ISSUED_INVOICE);
      paymentRepository.findOpenByInvoiceId.mockResolvedValue(buildPayment());

      const result = await service.createCheckoutSession('invoice-1');

      expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123' });
      expect(paymentProvider.createCheckoutSession).not.toHaveBeenCalled();
    });

    it.each([
      ['expires within 30 minutes', new Date(Date.now() + 10 * 60 * 1000)],
      ['has no recorded expiry (created before it was recorded)', null],
    ])('retires an open session that %s, then creates a fresh one', async (_, expiresAt) => {
      invoiceClient.findOneInvoice.mockResolvedValue(ISSUED_INVOICE);
      paymentRepository.findOpenByInvoiceId.mockResolvedValue(buildPayment({ providerSessionId: 'cs_old', expiresAt }));
      paymentProvider.createCheckoutSession.mockResolvedValue({
        providerSessionId: 'cs_new',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_new',
        expiresAt: new Date('2026-10-20T12:00:00.000Z'),
      });

      const result = await service.createCheckoutSession('invoice-1');

      // Expired at Stripe *before* being written off locally, so no payable session is left behind.
      expect(paymentProvider.expireCheckoutSession).toHaveBeenCalledWith('cs_old');
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-1', 'failed');
      expect(paymentProvider.expireCheckoutSession.mock.invocationCallOrder[0]).toBeLessThan(
        paymentRepository.updateStatus.mock.invocationCallOrder[0],
      );
      expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_new' });
    });

    it('returns the winner of a concurrent request instead of failing (open-session unique index)', async () => {
      invoiceClient.findOneInvoice.mockResolvedValue(ISSUED_INVOICE);
      paymentRepository.findOpenByInvoiceId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildPayment({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_winner' }));
      paymentProvider.createCheckoutSession.mockResolvedValue({
        providerSessionId: 'cs_loser',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_loser',
        expiresAt: new Date('2026-10-20T12:00:00.000Z'),
      });
      paymentRepository.create.mockRejectedValue(
        Object.assign(new Error('duplicate key value violates unique constraint'), { driverError: { code: '23505' } }),
      );

      const result = await service.createCheckoutSession('invoice-1');

      expect(paymentProvider.expireCheckoutSession).toHaveBeenCalledWith('cs_loser');
      expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_winner' });
    });
  });

  describe('expireOpenSessionForInvoice (invoice.cancelled)', () => {
    it('expires the open session at Stripe, then marks it failed', async () => {
      paymentRepository.findOpenByInvoiceId.mockResolvedValue(buildPayment({ providerSessionId: 'cs_open' }));

      await expect(service.expireOpenSessionForInvoice('invoice-1')).resolves.toBe(true);

      expect(paymentProvider.expireCheckoutSession).toHaveBeenCalledWith('cs_open');
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-1', 'failed');
      expect(paymentProvider.expireCheckoutSession.mock.invocationCallOrder[0]).toBeLessThan(
        paymentRepository.updateStatus.mock.invocationCallOrder[0],
      );
    });

    // Redelivery of the same event (at-least-once) must be harmless.
    it('does nothing when there is no open session', async () => {
      paymentRepository.findOpenByInvoiceId.mockResolvedValue(null);

      await expect(service.expireOpenSessionForInvoice('invoice-1')).resolves.toBe(false);

      expect(paymentProvider.expireCheckoutSession).not.toHaveBeenCalled();
      expect(paymentRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('leaves the session open (and the row pending) if Stripe fails, so the redelivered event retries', async () => {
      paymentRepository.findOpenByInvoiceId.mockResolvedValue(buildPayment());
      paymentProvider.expireCheckoutSession.mockRejectedValue(new Error('Stripe 503'));

      await expect(service.expireOpenSessionForInvoice('invoice-1')).rejects.toThrow('Stripe 503');

      expect(paymentRepository.updateStatus).not.toHaveBeenCalled();
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

    // A webhook carries no caller organization; invoice's MARK_PAID is scoped by the one it runs in.
    it("tells invoice in the payment's own organization", async () => {
      paymentProvider.parseWebhookEvent.mockReturnValue({
        type: 'payment_succeeded',
        providerSessionId: 'cs_test_123',
      });
      paymentRepository.findByProviderSessionId.mockResolvedValue(buildPayment({ organizationId: 'org-of-payment' }));
      let organizationId: string | undefined;
      invoiceClient.markInvoicePaid.mockImplementation(async () => {
        organizationId = getCurrentCorrelationContext()?.organizationId;
      });

      await service.handleWebhookEvent(Buffer.from('{}').toString('base64'), 'sig');

      expect(organizationId).toBe('org-of-payment');
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

    // e.g. the invoice was cancelled after the customer opened the checkout page: the money moved,
    // invoice refuses deterministically, and a Stripe retry would get the same answer forever.
    it.each([409, 404])(
      'flags for reconciliation and acknowledges the webhook when invoice refuses with %i',
      async (status) => {
        paymentProvider.parseWebhookEvent.mockReturnValue({
          type: 'payment_succeeded',
          providerSessionId: 'cs_test_123',
        });
        paymentRepository.findByProviderSessionId.mockResolvedValue(buildPayment());
        invoiceClient.markInvoicePaid.mockRejectedValue(new HttpException({ message: 'refused' }, status));

        await expect(service.handleWebhookEvent(Buffer.from('{}').toString('base64'), 'sig')).resolves.toBeUndefined();

        expect(paymentRepository.updateStatus).toHaveBeenLastCalledWith('payment-1', 'reconciliation_required');
      },
    );

    it('still lets Stripe retry when invoice is unavailable (503)', async () => {
      paymentProvider.parseWebhookEvent.mockReturnValue({
        type: 'payment_succeeded',
        providerSessionId: 'cs_test_123',
      });
      paymentRepository.findByProviderSessionId.mockResolvedValue(buildPayment());
      invoiceClient.markInvoicePaid.mockRejectedValue(new HttpException({ message: 'down' }, 503));

      await expect(service.handleWebhookEvent(Buffer.from('{}').toString('base64'), 'sig')).rejects.toBeInstanceOf(
        HttpException,
      );
    });

    it('flags a second successful payment for the same invoice instead of treating it as a normal success', async () => {
      paymentProvider.parseWebhookEvent.mockReturnValue({ type: 'payment_succeeded', providerSessionId: 'cs_second' });
      paymentRepository.findByProviderSessionId.mockResolvedValue(buildPayment({ id: 'payment-2' }));
      paymentRepository.hasOtherPaidPayment.mockResolvedValue(true);

      await service.handleWebhookEvent(Buffer.from('{}').toString('base64'), 'sig');

      expect(paymentRepository.hasOtherPaidPayment).toHaveBeenCalledWith('invoice-1', 'payment-2');
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-2', 'reconciliation_required');
      expect(invoiceClient.markInvoicePaid).not.toHaveBeenCalled();
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
