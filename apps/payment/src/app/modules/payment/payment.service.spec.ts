import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
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
  updateStatus: jest.Mock;
  setCheckout: jest.Mock;
  findById: jest.Mock;
  findByStatuses: jest.Mock;
};
type MockInvoiceClient = { findOneInvoice: jest.Mock; markInvoicePaid: jest.Mock };
type MockLedger = {
  recordGatewayPayment: jest.Mock;
  apply: jest.Mock;
  findForCheckout: jest.Mock;
  release: jest.Mock;
  refundableMinor: jest.Mock;
  refund: jest.Mock;
};

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
  let ledger: MockLedger;
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
      updateStatus: jest.fn().mockResolvedValue(undefined),
      setCheckout: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      findByStatuses: jest.fn(),
    };
    invoiceClient = { findOneInvoice: jest.fn(), markInvoicePaid: jest.fn() };
    // The ledger records the money and counts it on the invoice (its own spec covers how).
    ledger = {
      recordGatewayPayment: jest.fn(
        async (payment: PaymentEntity, details: { amount?: number; applyState?: string }) => ({
          id: 'entry-1',
          invoiceId: payment.invoiceId,
          amount: details.amount ?? payment.amount,
          currency: payment.currency,
          applyState: details.applyState ?? 'pending',
        }),
      ),
      apply: jest.fn().mockResolvedValue({ outcome: 'applied', invoice: { amountPaid: 100, total: 100 } }),
      findForCheckout: jest.fn(),
      release: jest.fn(),
      refundableMinor: jest.fn(),
      refund: jest.fn(),
    };

    service = new PaymentService(
      paymentProvider as never,
      paymentRepository as never,
      invoiceClient as never,
      registry as never,
      ledger as never,
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
      paymentRepository.findOpenByInvoiceId.mockResolvedValue(buildPayment({ amount: 220 }));

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
      ['above BDT 5 lakh', 500_000.01, 'the balance due is ৳5,00,000.01'],
      ['below BDT 10', 9.99, 'the balance due is ৳9.99'],
    ])('refuses an invoice %s up front, naming the limit (422)', async (_label, total, detail) => {
      invoiceClient.findOneInvoice.mockResolvedValue({ ...BDT_INVOICE, total });

      const error = await service.createCheckoutSession('invoice-1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as Error).message).toBe(
        `SSLCommerz takes ৳10.00 to ৳5,00,000.00 per payment; ${detail}. Ask for a part of it (amount), or record a bank transfer.`,
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
        bankTranId: 'BANK1',
        ...overrides,
      },
    });

    beforeEach(() => {
      paymentRepository.findByProviderSessionId.mockResolvedValue(sslPayment());
    });

    it("confirms with SSLCommerz, then marks the payment and the invoice paid -- in the payment's organization", async () => {
      sslcommerz.outcome.mockResolvedValue(valid());
      let organizationSeen: string | undefined;
      ledger.apply.mockImplementation(async () => {
        organizationSeen = getCurrentCorrelationContext()?.organizationId;
        return { outcome: 'applied', invoice: { amountPaid: 1380.5, total: 1380.5 } };
      });
      paymentRepository.findByProviderSessionId
        .mockResolvedValueOnce(sslPayment())
        .mockResolvedValueOnce(sslPayment({ status: 'paid' }));

      await expect(service.handleSslCommerzNotification({ tranId: TRAN, source: 'ipn' })).resolves.toEqual({
        invoiceId: 'invoice-1',
        status: 'paid',
      });

      expect(sslcommerz.outcome).toHaveBeenCalledWith(TRAN);
      // Into the ledger with the bank transaction a refund is made against, then onto the invoice.
      expect(ledger.recordGatewayPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'payment-9' }), {
        providerReference: 'BANK1',
        applyState: 'pending',
      });
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-9', 'paid');
      expect(ledger.apply).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-1' }));
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
      expect(ledger.recordGatewayPayment).not.toHaveBeenCalled();
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
      // The money moved, so it is in the ledger -- but never counted on the invoice.
      expect(ledger.recordGatewayPayment).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ applyState: 'refused' }),
      );
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-9', 'reconciliation_required');
      expect(ledger.apply).not.toHaveBeenCalled();
    });

    it('holds a high-risk payment for review without marking the invoice paid', async () => {
      sslcommerz.outcome.mockResolvedValue(valid({ riskLevel: '1', riskTitle: 'High Risk' }));

      await expect(service.handleSslCommerzNotification({ tranId: TRAN, source: 'ipn' })).resolves.toMatchObject({
        status: 'review_required',
      });
      expect(ledger.recordGatewayPayment).toHaveBeenCalledWith(expect.anything(), {
        providerReference: 'BANK1',
        applyState: 'held',
      });
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-9', 'review_required');
      expect(ledger.apply).not.toHaveBeenCalled();
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
      expect(ledger.apply).toHaveBeenCalled();
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

  describe('paying in parts', () => {
    // A 13.8-lakh BDT invoice, half paid: SSLCommerz takes at most 5 lakh per payment.
    const BIG = {
      ...ISSUED_INVOICE,
      currency: 'BDT',
      total: 1_380_000.5,
      amountPaid: 690_000,
      balanceDue: 690_000.5,
    };

    beforeEach(() => {
      registry.forCheckout.mockResolvedValue(sslcommerz);
      invoiceClient.findOneInvoice.mockResolvedValue(BIG);
      paymentRepository.create.mockResolvedValue(buildPayment({ id: 'payment-9', provider: 'sslcommerz' }));
      sslcommerz.createCheckoutSession.mockResolvedValue({
        providerSessionId: 'einv1',
        checkoutUrl: 'https://sandbox.sslcommerz.com/EasyCheckOut/x',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
    });

    it('collects a named part of the balance', async () => {
      await service.createCheckoutSession('invoice-1', 500_000);

      expect(paymentRepository.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 500_000 }));
      expect(sslcommerz.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ amount: 500_000 }));
    });

    it('asks for a part when the balance is over the provider limit, naming both', async () => {
      await expect(service.createCheckoutSession('invoice-1')).rejects.toThrow(
        new UnprocessableEntityException(
          'SSLCommerz takes ৳10.00 to ৳5,00,000.00 per payment; the balance due is ৳6,90,000.50. Ask for a part of it (amount), or record a bank transfer.',
        ),
      );
    });

    it('defaults to the whole balance (not the total) when it fits', async () => {
      invoiceClient.findOneInvoice.mockResolvedValue({ ...BIG, amountPaid: 1_000_000, balanceDue: 380_000.5 });

      await service.createCheckoutSession('invoice-1');

      expect(sslcommerz.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ amount: 380_000.5 }));
    });

    it.each([
      [700_000, /more than the balance due \(৳6,90,000.50\)/],
      [-5, /positive/],
      [10.005, /more than 2 decimal places/],
    ])('refuses %p', async (amount, message) => {
      await expect(service.createCheckoutSession('invoice-1', amount)).rejects.toThrow(message);
      expect(paymentRepository.create).not.toHaveBeenCalled();
    });

    it('refuses a link when nothing is owed', async () => {
      invoiceClient.findOneInvoice.mockResolvedValue({
        ...BIG,
        status: 'issued',
        amountPaid: 1_380_000.5,
        balanceDue: 0,
      });

      await expect(service.createCheckoutSession('invoice-1')).rejects.toThrow('Nothing is owed on this invoice.');
    });

    // One open session per invoice: a different part means a different session.
    it('does not reuse an open session for a different amount', async () => {
      paymentRepository.findOpenByInvoiceId.mockResolvedValue(
        buildPayment({
          id: 'payment-old',
          provider: 'sslcommerz',
          amount: 500_000,
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
      );

      await service.createCheckoutSession('invoice-1', 190_000.5);

      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-old', 'superseded');
      expect(sslcommerz.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ amount: 190_000.5 }));
    });

    // An invoice service from before the ledger reports no balance: nothing could be part-paid then.
    it('treats an invoice without balanceDue (mid-rollout) as owing its total', async () => {
      registry.forCheckout.mockResolvedValue(paymentProvider);
      invoiceClient.findOneInvoice.mockResolvedValue(ISSUED_INVOICE);
      paymentProvider.createCheckoutSession.mockResolvedValue({
        providerSessionId: 'cs_1',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_1',
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      await service.createCheckoutSession('invoice-1');

      expect(paymentProvider.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ amount: 220 }));
    });
  });

  describe('payments waiting for a person', () => {
    const PAYMENT_ID = '6c0f3a52-2f0e-4c1b-9a51-0d2f7b6c9e10';
    const held = () =>
      buildPayment({ id: PAYMENT_ID, provider: 'sslcommerz', status: 'review_required', currency: 'BDT' });

    beforeEach(() => {
      paymentRepository.findById.mockResolvedValue(held());
      ledger.findForCheckout.mockResolvedValue({
        id: 'entry-9',
        applyState: 'held',
        amount: 1380.5,
        currency: 'BDT',
        invoiceId: 'invoice-1',
      });
    });

    it('accepting counts the held payment on the invoice', async () => {
      ledger.release.mockResolvedValue({ outcome: 'applied', invoice: { amountPaid: 1380.5, total: 1380.5 } });

      await expect(service.acceptHeld(PAYMENT_ID)).resolves.toEqual({ invoiceId: 'invoice-1', status: 'paid' });
      expect(ledger.release).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-9' }));
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith(PAYMENT_ID, 'paid');
    });

    it('refusing refunds everything left of it, and marks the checkout refunded', async () => {
      ledger.refundableMinor.mockResolvedValue(138_050);
      ledger.refund.mockResolvedValue({ id: 'refund-1', state: 'pending' });

      await service.refuseHeld(PAYMENT_ID, 'Card reported stolen.');

      expect(ledger.refund).toHaveBeenCalledWith('invoice-1', {
        paymentEntryId: 'entry-9',
        amount: 1380.5,
        reason: 'Card reported stolen.',
      });
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith(PAYMENT_ID, 'refunded');
    });

    it('keeps the checkout waiting when the refund itself failed', async () => {
      ledger.refundableMinor.mockResolvedValue(138_050);
      ledger.refund.mockResolvedValue({ id: 'refund-1', state: 'failed' });

      await service.refuseHeld(PAYMENT_ID, 'Card reported stolen.');

      expect(paymentRepository.updateStatus).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a payment that is not waiting',
        () => paymentRepository.findById.mockResolvedValue({ ...held(), status: 'paid' }),
        ConflictException,
      ],
      ['an unknown payment', () => paymentRepository.findById.mockResolvedValue(null), NotFoundException],
    ])('refuses to act on %s', async (_label, arrange, error) => {
      arrange();

      await expect(service.acceptHeld(PAYMENT_ID)).rejects.toBeInstanceOf(error);
      expect(ledger.release).not.toHaveBeenCalled();
    });

    it('lists what is waiting, with its ledger entry', async () => {
      paymentRepository.findByStatuses.mockResolvedValue([held()]);

      await expect(service.listAttention()).resolves.toEqual([
        expect.objectContaining({
          paymentId: PAYMENT_ID,
          status: 'review_required',
          ledgerEntryId: 'entry-9',
          amount: 1380.5,
        }),
      ]);
      expect(paymentRepository.findByStatuses).toHaveBeenCalledWith(['review_required', 'reconciliation_required']);
    });
  });

  describe('handleWebhookEvent (Stripe)', () => {
    const succeeded = (overrides: Record<string, unknown> = {}) =>
      paymentProvider.parseWebhookEvent.mockReturnValue({
        type: 'payment_succeeded',
        providerSessionId: 'cs_test_123',
        providerReference: 'pi_123',
        ...overrides,
      });
    const webhook = () => service.handleWebhookEvent(Buffer.from('{}').toString('base64'), 'sig');

    beforeEach(() => paymentRepository.findByProviderSessionId.mockResolvedValue(buildPayment()));

    it('records the payment with its payment_intent, marks the checkout paid, and counts it on the invoice', async () => {
      succeeded();

      await webhook();

      expect(ledger.recordGatewayPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'payment-1' }), {
        providerReference: 'pi_123',
        applyState: 'pending',
      });
      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-1', 'paid');
      expect(ledger.apply).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-1' }));
    });

    // A webhook carries no caller organization; invoice is scoped by the one the payment was started in.
    it("tells invoice in the payment's own organization", async () => {
      succeeded();
      paymentRepository.findByProviderSessionId.mockResolvedValue(buildPayment({ organizationId: 'org-of-payment' }));
      let organizationId: string | undefined;
      ledger.apply.mockImplementation(async () => {
        organizationId = getCurrentCorrelationContext()?.organizationId;
        return { outcome: 'applied', invoice: { amountPaid: 100, total: 100 } };
      });

      await webhook();

      expect(organizationId).toBe('org-of-payment');
    });

    // e.g. the invoice was cancelled after the payer opened the checkout: the money is recorded, a
    // refund is owed, and a retry would get the same answer -- the webhook is acknowledged.
    it('flags the checkout for reconciliation when invoice refuses the money, and acknowledges', async () => {
      succeeded();
      ledger.apply.mockResolvedValue({
        outcome: 'refused',
        reason: 'Cannot apply a payment to an invoice that is cancelled.',
      });

      await expect(webhook()).resolves.toBeUndefined();

      expect(paymentRepository.updateStatus).toHaveBeenLastCalledWith('payment-1', 'reconciliation_required');
    });

    // Recorded in the ledger already; the ledger worker counts it once invoice is back.
    it('acknowledges when invoice is unreachable: the payment is recorded, and counted later', async () => {
      succeeded();
      ledger.apply.mockResolvedValue({ outcome: 'retry' });

      await expect(webhook()).resolves.toBeUndefined();

      expect(ledger.recordGatewayPayment).toHaveBeenCalled();
      expect(paymentRepository.updateStatus).toHaveBeenLastCalledWith('payment-1', 'paid');
    });

    // e.g. paid through a session retired while the payer was still on it: the excess is owed back.
    it('flags an overpaid invoice for reconciliation', async () => {
      succeeded();
      ledger.apply.mockResolvedValue({ outcome: 'applied', invoice: { amountPaid: 440, total: 220 } });

      await webhook();

      expect(paymentRepository.updateStatus).toHaveBeenLastCalledWith('payment-1', 'reconciliation_required');
    });

    // Stripe redelivers: the ledger finds the entry it already has, already counted.
    it('is idempotent: a redelivered webhook neither records nor counts the payment again', async () => {
      succeeded();
      ledger.recordGatewayPayment.mockResolvedValue({ id: 'entry-1', applyState: 'applied' });

      await webhook();

      expect(ledger.apply).not.toHaveBeenCalled();
    });

    it('marks an expired checkout failed', async () => {
      paymentProvider.parseWebhookEvent.mockReturnValue({ type: 'payment_failed', providerSessionId: 'cs_test_123' });

      await webhook();

      expect(paymentRepository.updateStatus).toHaveBeenCalledWith('payment-1', 'failed');
      expect(ledger.recordGatewayPayment).not.toHaveBeenCalled();
    });

    it('does nothing for an ignored event type', async () => {
      paymentProvider.parseWebhookEvent.mockReturnValue({ type: 'ignored' });

      await webhook();

      expect(paymentRepository.findByProviderSessionId).not.toHaveBeenCalled();
    });

    it('throws when the signature header is missing', async () => {
      await expect(service.handleWebhookEvent(Buffer.from('{}').toString('base64'), '')).rejects.toThrow(
        'Missing webhook signature.',
      );
    });
  });
});
