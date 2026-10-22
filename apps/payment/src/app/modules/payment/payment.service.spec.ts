import {
  BadGatewayException,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SslCommerzRejectedError, SslCommerzUnavailableError } from './sslcommerz/sslcommerz.client';
import { getCurrentCorrelationContext } from '@libs/logging/correlation-context';
import { PaymentService } from './payment.service';
import { PaymentEntity } from '../../../database/entities/payment.entity';

type MockPaymentProvider = {
  name: 'stripe';
  canExpireSessions: true;
  amountLimits: jest.Mock;
  createCheckoutSession: jest.Mock;
  expireCheckoutSession: jest.Mock;
  parseWebhookEvent: jest.Mock;
};
type MockSslCommerz = {
  name: 'sslcommerz';
  canExpireSessions: false;
  amountLimits: jest.Mock;
  newReference: jest.Mock;
  createCheckoutSession: jest.Mock;
  expireCheckoutSession: jest.Mock;
  outcome: jest.Mock;
};
type MockPaymentRepository = {
  create: jest.Mock;
  findByProviderSessionId: jest.Mock;
  findOpenByInvoiceId: jest.Mock;
  hasOtherPaidPayment: jest.Mock;
  updateStatus: jest.Mock;
  setCheckout: jest.Mock;
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

const CLIENT = { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Main St' };
const ISSUED_INVOICE = { invoiceNumber: 'INV-0001', total: 220, currency: 'USD', status: 'issued', client: CLIENT };

describe('PaymentService', () => {
  let paymentProvider: MockPaymentProvider;
  let sslcommerz: MockSslCommerz;
  let registry: { forCheckout: jest.Mock; byName: jest.Mock; sslcommerz: MockSslCommerz };
  let paymentRepository: MockPaymentRepository;
  let invoiceClient: MockInvoiceClient;
  let service: PaymentService;

  beforeEach(() => {
    paymentProvider = {
      name: 'stripe',
      canExpireSessions: true,
      amountLimits: jest.fn().mockReturnValue(null),
      createCheckoutSession: jest.fn(),
      expireCheckoutSession: jest.fn().mockResolvedValue(undefined),
      parseWebhookEvent: jest.fn(),
    };
    sslcommerz = {
      name: 'sslcommerz',
      canExpireSessions: false,
      amountLimits: jest.fn().mockReturnValue({ minMinor: 1_000, maxMinor: 50_000_000 }),
      newReference: jest.fn().mockReturnValue('einv0123456789abcdef0123456789'),
      createCheckoutSession: jest.fn(),
      expireCheckoutSession: jest.fn().mockResolvedValue(undefined),
      outcome: jest.fn(),
    };
    // Stripe unless a test routes a checkout to SSLCommerz.
    registry = {
      forCheckout: jest.fn().mockResolvedValue(paymentProvider),
      byName: jest.fn((name: string) => (name === 'sslcommerz' ? sslcommerz : paymentProvider)),
      sslcommerz,
    };
    paymentRepository = {
      create: jest.fn(),
      findByProviderSessionId: jest.fn(),
      findOpenByInvoiceId: jest.fn().mockResolvedValue(null),
      hasOtherPaidPayment: jest.fn().mockResolvedValue(false),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      setCheckout: jest.fn().mockResolvedValue(undefined),
    };
    invoiceClient = { findOneInvoice: jest.fn(), markInvoicePaid: jest.fn() };

    service = new PaymentService(
      paymentProvider as never,
      paymentRepository as never,
      invoiceClient as never,
      registry as never,
    );
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

      expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123', provider: 'stripe' });
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
        provider: 'stripe',
      });
    });

    it('hands out the open session again instead of creating a second payable one', async () => {
      invoiceClient.findOneInvoice.mockResolvedValue(ISSUED_INVOICE);
      paymentRepository.findOpenByInvoiceId.mockResolvedValue(buildPayment());

      const result = await service.createCheckoutSession('invoice-1');

      expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123', provider: 'stripe' });
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
      expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_new', provider: 'stripe' });
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
      expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_winner', provider: 'stripe' });
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

  describe('SSLCommerz checkout', () => {
    const TRAN = 'einv0123456789abcdef0123456789';
    const BDT_INVOICE = {
      ...ISSUED_INVOICE,
      total: 1380.5,
      currency: 'BDT',
      client: { ...CLIENT, phone: '+880 1711-111111' },
    };

    beforeEach(() => {
      registry.forCheckout.mockResolvedValue(sslcommerz);
      invoiceClient.findOneInvoice.mockResolvedValue(BDT_INVOICE);
      paymentRepository.create.mockResolvedValue(buildPayment({ id: 'payment-9', provider: 'sslcommerz' }));
      sslcommerz.createCheckoutSession.mockResolvedValue({
        providerSessionId: TRAN,
        checkoutUrl: 'https://sandbox.sslcommerz.com/EasyCheckOut/x',
        expiresAt: new Date('2026-10-22T12:00:00.000Z'),
      });
    });

    // No API closes an SSLCommerz session: the row (with our tran_id) must exist before the session does.
    it('records the payment under its own tran_id before creating the session, then stores the link', async () => {
      const order: string[] = [];
      paymentRepository.create.mockImplementation(async () => {
        order.push('record');
        return buildPayment({ id: 'payment-9', provider: 'sslcommerz' });
      });
      sslcommerz.createCheckoutSession.mockImplementation(async () => {
        order.push('session');
        return {
          providerSessionId: TRAN,
          checkoutUrl: 'https://sandbox.sslcommerz.com/EasyCheckOut/x',
          expiresAt: new Date('2026-10-22T12:00:00.000Z'),
        };
      });

      await expect(service.createCheckoutSession('invoice-1')).resolves.toEqual({
        checkoutUrl: 'https://sandbox.sslcommerz.com/EasyCheckOut/x',
        provider: 'sslcommerz',
      });

      expect(order).toEqual(['record', 'session']);
      expect(paymentRepository.create).toHaveBeenCalledWith({
        invoiceId: 'invoice-1',
        provider: 'sslcommerz',
        providerSessionId: TRAN,
        status: 'pending',
        amount: 1380.5,
        currency: 'BDT',
      });
      expect(sslcommerz.createCheckoutSession).toHaveBeenCalledWith({
        reference: TRAN,
        invoiceId: 'invoice-1',
        invoiceNumber: 'INV-0001',
        amount: 1380.5,
        currency: 'BDT',
        customer: { name: 'Acme Corp', email: 'billing@acme.test', phone: '+880 1711-111111', address: '1 Main St' },
      });
      expect(paymentRepository.setCheckout).toHaveBeenCalledWith(
        'payment-9',
        'https://sandbox.sslcommerz.com/EasyCheckOut/x',
        new Date('2026-10-22T12:00:00.000Z'),
      );
    });

    it('marks the recorded payment failed when SSLCommerz refuses the session, and says why (502)', async () => {
      sslcommerz.createCheckoutSession.mockRejectedValue(
        new SslCommerzRejectedError(
          'SSLCommerz refused the payment session: Store Credential Error Or Store is De-active.',
        ),
      );

      await expect(service.createCheckoutSession('invoice-1')).rejects.toThrow(
        new BadGatewayException(
          'SSLCommerz refused the payment session: Store Credential Error Or Store is De-active.',
        ),
      );
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-9', 'failed');
    });

    it('answers 503 when SSLCommerz is unreachable', async () => {
      sslcommerz.createCheckoutSession.mockRejectedValue(
        new SslCommerzUnavailableError('SSLCommerz could not be reached.'),
      );

      await expect(service.createCheckoutSession('invoice-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it.each([
      ['above BDT 5 lakh', 500_000.01, 'this invoice is ৳5,00,000.01'],
      ['below BDT 10', 9.99, 'this invoice is ৳9.99'],
    ])('refuses an invoice %s up front, naming the limit (422)', async (_label, total, detail) => {
      invoiceClient.findOneInvoice.mockResolvedValue({ ...BDT_INVOICE, total });

      const error = await service.createCheckoutSession('invoice-1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as Error).message).toBe(
        `SSLCommerz takes ৳10.00 to ৳5,00,000.00 per payment; ${detail}. Pay it by bank transfer instead.`,
      );
      expect(paymentRepository.create).not.toHaveBeenCalled();
      expect(sslcommerz.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('accepts exactly the limits', async () => {
      invoiceClient.findOneInvoice.mockResolvedValue({ ...BDT_INVOICE, total: 500_000 });
      await expect(service.createCheckoutSession('invoice-1')).resolves.toMatchObject({ provider: 'sslcommerz' });
    });

    // SSLCommerz sessions can't be closed: "superseded", not "failed" -- it may still be paid through.
    it('supersedes an old SSLCommerz session locally instead of trying to expire it', async () => {
      paymentRepository.findOpenByInvoiceId.mockResolvedValue(
        buildPayment({
          id: 'payment-old',
          provider: 'sslcommerz',
          providerSessionId: 'einvold',
          expiresAt: new Date(Date.now() + 60_000),
        }),
      );

      await service.createCheckoutSession('invoice-1');

      expect(sslcommerz.expireCheckoutSession).not.toHaveBeenCalled();
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-old', 'superseded');
    });

    // The organization connected SSLCommerz after a Stripe link was handed out: switch, retiring the Stripe one.
    it('does not hand out an open session from another provider', async () => {
      paymentRepository.findOpenByInvoiceId.mockResolvedValue(
        buildPayment({ id: 'payment-stripe', providerSessionId: 'cs_open' }),
      );

      await expect(service.createCheckoutSession('invoice-1')).resolves.toMatchObject({ provider: 'sslcommerz' });
      expect(paymentProvider.expireCheckoutSession).toHaveBeenCalledWith('cs_open');
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-stripe', 'failed');
    });

    it('asks a concurrent loser to retry while the winning link is still being created', async () => {
      paymentRepository.create.mockRejectedValue({ driverError: { code: '23505' } });
      paymentRepository.findOpenByInvoiceId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildPayment({ provider: 'sslcommerz', checkoutUrl: null }));

      await expect(service.createCheckoutSession('invoice-1')).rejects.toThrow(
        new ConflictException('A payment link for this invoice is being created; try again in a moment.'),
      );
      expect(sslcommerz.createCheckoutSession).not.toHaveBeenCalled();
    });
  });

  describe("handleSslCommerzNotification (IPN and the payer's return)", () => {
    const TRAN = 'einv0123456789abcdef0123456789';
    const sslPayment = (overrides: Partial<PaymentEntity> = {}) =>
      buildPayment({
        id: 'payment-9',
        provider: 'sslcommerz',
        providerSessionId: TRAN,
        amount: 1380.5,
        currency: 'BDT',
        organizationId: 'org-1',
        ...overrides,
      });
    const valid = (overrides: Record<string, string> = {}) => ({
      kind: 'paid',
      transaction: {
        status: 'VALID',
        tranId: TRAN,
        valId: 'VAL1',
        amount: '1380.50',
        currency: 'BDT',
        riskLevel: '0',
        riskTitle: 'Safe',
        ...overrides,
      },
    });

    beforeEach(() => {
      paymentRepository.findByProviderSessionId.mockResolvedValue(sslPayment());
      invoiceClient.markInvoicePaid.mockResolvedValue({ id: 'invoice-1', status: 'paid' });
    });

    it("confirms with SSLCommerz, then marks the payment and the invoice paid -- in the payment's organization", async () => {
      sslcommerz.outcome.mockResolvedValue(valid());
      let organizationSeen: string | undefined;
      invoiceClient.markInvoicePaid.mockImplementation(async () => {
        organizationSeen = getCurrentCorrelationContext()?.organizationId;
        return { id: 'invoice-1', status: 'paid' };
      });
      paymentRepository.findByProviderSessionId
        .mockResolvedValueOnce(sslPayment())
        .mockResolvedValueOnce(sslPayment({ status: 'paid' }));

      await expect(service.handleSslCommerzNotification({ tranId: TRAN, source: 'ipn' })).resolves.toEqual({
        invoiceId: 'invoice-1',
        status: 'paid',
      });

      expect(sslcommerz.outcome).toHaveBeenCalledWith(TRAN);
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-9', 'paid');
      expect(invoiceClient.markInvoicePaid).toHaveBeenCalledWith('invoice-1');
      expect(organizationSeen).toBe('org-1');
    });

    // A forged or replayed notification can't move anything: the notification's own claims are never read.
    it('only acts on what SSLCommerz says, never on the notification', async () => {
      sslcommerz.outcome.mockResolvedValue({ kind: 'pending' });

      await expect(service.handleSslCommerzNotification({ tranId: TRAN, source: 'success' })).resolves.toEqual({
        invoiceId: 'invoice-1',
        status: 'pending',
      });
      expect(paymentRepository.updateStatus).not.toHaveBeenCalled();
      expect(invoiceClient.markInvoicePaid).not.toHaveBeenCalled();
    });

    it.each([
      ['a different amount', { amount: '1000.00' }],
      ['a different currency', { currency: 'USD' }],
      ['another transaction', { tranId: 'einvsomethingelse' }],
      ['an amount that is not one', { amount: 'abc' }],
    ])('flags a payment with %s for reconciliation and never marks the invoice paid', async (_label, overrides) => {
      sslcommerz.outcome.mockResolvedValue(valid(overrides));

      await expect(service.handleSslCommerzNotification({ tranId: TRAN, source: 'ipn' })).resolves.toMatchObject({
        status: 'reconciliation_required',
      });
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-9', 'reconciliation_required');
      expect(invoiceClient.markInvoicePaid).not.toHaveBeenCalled();
    });

    it('holds a high-risk payment for review without marking the invoice paid', async () => {
      sslcommerz.outcome.mockResolvedValue(valid({ riskLevel: '1', riskTitle: 'High Risk' }));

      await expect(service.handleSslCommerzNotification({ tranId: TRAN, source: 'ipn' })).resolves.toMatchObject({
        status: 'review_required',
      });
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-9', 'review_required');
      expect(invoiceClient.markInvoicePaid).not.toHaveBeenCalled();
    });

    it('marks a pending payment failed when every attempt ended unpaid', async () => {
      sslcommerz.outcome.mockResolvedValue({ kind: 'failed' });

      await expect(service.handleSslCommerzNotification({ tranId: TRAN, source: 'fail' })).resolves.toMatchObject({
        status: 'failed',
      });
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-9', 'failed');
    });

    // The IPN and the return race, and SSLCommerz retries the IPN.
    it.each(['paid', 'review_required', 'reconciliation_required'] as const)(
      'is a no-op for a payment already %s, without asking SSLCommerz again',
      async (status) => {
        paymentRepository.findByProviderSessionId.mockResolvedValue(sslPayment({ status }));

        await expect(service.handleSslCommerzNotification({ tranId: TRAN, source: 'ipn' })).resolves.toEqual({
          invoiceId: 'invoice-1',
          status,
        });
        expect(sslcommerz.outcome).not.toHaveBeenCalled();
        expect(paymentRepository.updateStatus).not.toHaveBeenCalled();
      },
    );

    // A superseded session can't be closed; a payer who used it anyway has paid.
    it('settles a late payment through a superseded session', async () => {
      paymentRepository.findByProviderSessionId.mockResolvedValue(sslPayment({ status: 'superseded' }));
      sslcommerz.outcome.mockResolvedValue(valid());

      await service.handleSslCommerzNotification({ tranId: TRAN, source: 'ipn' });

      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-9', 'paid');
      expect(invoiceClient.markInvoicePaid).toHaveBeenCalledWith('invoice-1');
    });

    it('answers "unknown" for a tran_id that is not one of our SSLCommerz payments', async () => {
      paymentRepository.findByProviderSessionId.mockResolvedValue(null);
      await expect(service.handleSslCommerzNotification({ tranId: 'einvnope', source: 'ipn' })).resolves.toEqual({
        status: 'unknown',
      });

      paymentRepository.findByProviderSessionId.mockResolvedValue(buildPayment({ providerSessionId: 'cs_x' }));
      await expect(service.handleSslCommerzNotification({ tranId: 'cs_x', source: 'ipn' })).resolves.toEqual({
        status: 'unknown',
      });
      expect(sslcommerz.outcome).not.toHaveBeenCalled();
    });

    it.each([undefined, '', 'has spaces', 'x'.repeat(31), 42])('refuses tran_id %p (400)', async (tranId) => {
      await expect(service.handleSslCommerzNotification({ tranId: tranId as never, source: 'ipn' })).rejects.toThrow(
        'A valid tran_id is required.',
      );
    });

    // An IPN that can't be confirmed must be retried; a returning payer just sees "pending".
    it('answers 503 to an IPN when SSLCommerz is unreachable, but "pending" to a returning payer', async () => {
      sslcommerz.outcome.mockRejectedValue(new SslCommerzUnavailableError('SSLCommerz could not be reached.'));

      await expect(service.handleSslCommerzNotification({ tranId: TRAN, source: 'ipn' })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(service.handleSslCommerzNotification({ tranId: TRAN, source: 'success' })).resolves.toEqual({
        invoiceId: 'invoice-1',
        status: 'pending',
      });
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
