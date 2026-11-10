import { ServiceUnavailableException } from '@nestjs/common';
import { SslCommerzPaymentProvider } from './sslcommerz-payment.provider';
import { SslCommerzRejectedError, SslCommerzUnavailableError } from './sslcommerz.client';
import { RefundOutcomeUnknownError } from '../payment-provider.interface';

const CREDENTIALS = { storeId: 'testbox', storePassword: 'qwerty', sandbox: true };

describe('SslCommerzPaymentProvider', () => {
  let credentials: { resolveSslCommerz: jest.Mock };
  let client: {
    createSession: jest.Mock;
    queryTransaction: jest.Mock;
    validate: jest.Mock;
    refund: jest.Mock;
    refundStatus: jest.Mock;
  };
  let provider: SslCommerzPaymentProvider;

  beforeEach(() => {
    credentials = { resolveSslCommerz: jest.fn().mockResolvedValue(CREDENTIALS) };
    client = {
      createSession: jest.fn(),
      queryTransaction: jest.fn(),
      validate: jest.fn(),
      refund: jest.fn(),
      refundStatus: jest.fn(),
    };
    provider = new SslCommerzPaymentProvider(credentials as never, client as never, {
      publicBaseUrl: 'https://api.example.com/api/v1',
    });
  });

  it('has the documented BDT limits, and none for currencies it is never routed', () => {
    expect(provider.amountLimits('BDT')).toEqual({ minMinor: 1_000, maxMinor: 50_000_000 });
    expect(provider.amountLimits('USD')).toBeNull();
    expect(provider.canExpireSessions).toBe(false);
  });

  it('makes 30-character tran_ids (the SSLCommerz maximum), never the same twice', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => provider.newReference()));

    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^einv[0-9a-f]{26}$/);
  });

  describe('createCheckoutSession', () => {
    beforeEach(() =>
      client.createSession.mockResolvedValue({
        sessionKey: 'K',
        gatewayUrl: 'https://sandbox.sslcommerz.com/EasyCheckOut/x',
      }),
    );

    it("sends taka with two decimals and bff's return and IPN routes, and is reusable for its assumed hour", async () => {
      const before = Date.now();

      const session = await provider.createCheckoutSession({
        reference: 'einv0123456789abcdef0123456789',
        invoiceId: 'invoice-1',
        invoiceNumber: 'INV-2026-000017',
        amount: 1_380_000.5,
        currency: 'BDT',
        customer: { name: 'Dhaka Traders Ltd', email: 'ap@dhaka.test' },
      });

      expect(client.createSession).toHaveBeenCalledWith(CREDENTIALS, {
        tranId: 'einv0123456789abcdef0123456789',
        totalAmount: '1380000.50',
        currency: 'BDT',
        successUrl: 'https://api.example.com/api/v1/payments/sslcommerz/return/success',
        failUrl: 'https://api.example.com/api/v1/payments/sslcommerz/return/fail',
        cancelUrl: 'https://api.example.com/api/v1/payments/sslcommerz/return/cancel',
        ipnUrl: 'https://api.example.com/api/v1/payments/sslcommerz/ipn',
        productName: 'Invoice INV-2026-000017',
        customer: { name: 'Dhaka Traders Ltd', email: 'ap@dhaka.test' },
        valueA: 'invoice-1',
      });
      expect(session.providerSessionId).toBe('einv0123456789abcdef0123456789');
      expect(session.checkoutUrl).toBe('https://sandbox.sslcommerz.com/EasyCheckOut/x');
      expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
    });

    it('is a 503 when the server has no public base URL to send payers and IPNs back to', async () => {
      const unconfigured = new SslCommerzPaymentProvider(credentials as never, client as never, {});

      await expect(
        unconfigured.createCheckoutSession({
          reference: 'einv1',
          invoiceId: 'i',
          invoiceNumber: 'n',
          amount: 10,
          currency: 'BDT',
          customer: { name: 'A', email: 'a@b.test' },
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(client.createSession).not.toHaveBeenCalled();
    });
  });

  describe('outcome (what SSLCommerz says, by tran_id)', () => {
    const VALIDATED = {
      status: 'VALID',
      tranId: 'einv1',
      valId: 'VAL1',
      amount: '1380.50',
      currency: 'BDT',
      riskLevel: '0',
      riskTitle: 'Safe',
    };

    it('validates the successful attempt, with the credentials of a store even after it was disconnected', async () => {
      client.queryTransaction.mockResolvedValue([
        { status: 'FAILED', valId: '' },
        { status: 'VALID', valId: 'VAL1' },
      ]);
      client.validate.mockResolvedValue(VALIDATED);

      await expect(provider.outcome('einv1')).resolves.toEqual({ kind: 'paid', transaction: VALIDATED });
      expect(client.validate).toHaveBeenCalledWith(CREDENTIALS, 'VAL1');
      expect(credentials.resolveSslCommerz).toHaveBeenCalledWith({ forSettlement: true });
    });

    it('accepts VALIDATED (already validated before: the IPN and the return race)', async () => {
      client.queryTransaction.mockResolvedValue([{ status: 'VALIDATED', valId: 'VAL1' }]);
      client.validate.mockResolvedValue({ ...VALIDATED, status: 'VALIDATED' });

      await expect(provider.outcome('einv1')).resolves.toMatchObject({ kind: 'paid' });
    });

    it('is not paid when the Validation API disagrees with the query', async () => {
      client.queryTransaction.mockResolvedValue([{ status: 'VALID', valId: 'VAL1' }]);
      client.validate.mockResolvedValue({ ...VALIDATED, status: 'INVALID_TRANSACTION' });

      await expect(provider.outcome('einv1')).resolves.toEqual({ kind: 'pending' });
    });

    it.each([
      [
        'every attempt failed, cancelled or expired',
        [{ status: 'FAILED' }, { status: 'CANCELLED' }, { status: 'EXPIRED' }],
        'failed',
      ],
      ['an attempt is still processing', [{ status: 'FAILED' }, { status: 'PROCESSING' }], 'pending'],
      ['the payer is still on the page', [{ status: 'PENDING' }], 'pending'],
      ['SSLCommerz has no attempt yet', [{ status: 'INVALID' }], 'pending'],
      ['there is nothing at all', [], 'pending'],
    ])('is %s -> %s', async (_label, attempts, kind) => {
      client.queryTransaction.mockResolvedValue(attempts.map((attempt) => ({ valId: '', ...attempt })));

      await expect(provider.outcome('einv1')).resolves.toEqual({ kind });
      expect(client.validate).not.toHaveBeenCalled();
    });
  });

  describe('refunds (asynchronous at SSLCommerz, and never safe to repeat)', () => {
    const REFUND = {
      paymentReference: 'BANK1',
      amount: 1300,
      currency: 'BDT',
      refundId: '0f6a2b9c-3d4e-4f50-8a1b-2c3d4e5f6a7b',
      reason: "Customer's duplicate payment",
    };

    it('is not idempotent: a repeated refund_trans_id refunded twice when probed', () => {
      expect(provider.refundsAreIdempotent).toBe(false);
    });

    it('refunds against the bank_tran_id with a 30-character refund_trans_id from the entry id, then waits', async () => {
      client.refund.mockResolvedValue({ status: 'success', refundRefId: 'RRF1', errorReason: '' });

      await expect(provider.refund(REFUND)).resolves.toEqual({ state: 'pending', providerReference: 'RRF1' });
      expect(client.refund).toHaveBeenCalledWith(CREDENTIALS, {
        bankTranId: 'BANK1',
        refundTransId: 'r0f6a2b9c3d4e4f508a1b2c3d4e5f6',
        amount: '1300.00',
        remarks: "Customer's duplicate payment",
      });
      expect(client.refund.mock.calls[0][1].refundTransId).toHaveLength(30);
      expect(credentials.resolveSslCommerz).toHaveBeenCalledWith({ forSettlement: true });
    });

    it('is failed when SSLCommerz refuses it, with its reason', async () => {
      client.refund.mockResolvedValue({ status: 'failed', refundRefId: '', errorReason: 'Invalid amount' });
      await expect(provider.refund(REFUND)).resolves.toEqual({ state: 'failed', failureReason: 'Invalid amount' });

      client.refund.mockRejectedValue(new SslCommerzRejectedError('SSLCommerz refused the store credentials'));
      await expect(provider.refund(REFUND)).resolves.toMatchObject({ state: 'failed' });
    });

    it('is an unknown outcome when SSLCommerz does not answer: it may have been made', async () => {
      client.refund.mockRejectedValue(new SslCommerzUnavailableError('timeout'));

      await expect(provider.refund(REFUND)).rejects.toBeInstanceOf(RefundOutcomeUnknownError);
    });

    it('is failed, not stuck pending, when it never got as far as SSLCommerz', async () => {
      credentials.resolveSslCommerz.mockRejectedValue(
        new ServiceUnavailableException('PAYMENT_CREDENTIALS_KEY is missing'),
      );

      await expect(provider.refund(REFUND)).resolves.toEqual({
        state: 'failed',
        failureReason: 'Refund not sent: PAYMENT_CREDENTIALS_KEY is missing',
      });
      expect(client.refund).not.toHaveBeenCalled();
    });

    it.each([
      ['refunded', { state: 'settled', providerReference: 'RRF1' }],
      ['processing', { state: 'pending', providerReference: 'RRF1' }],
      ['cancelled', { state: 'failed', providerReference: 'RRF1', failureReason: 'SSLCommerz refund cancelled.' }],
    ])('follows a refund that is %s', async (status, expected) => {
      client.refundStatus.mockResolvedValue({ status, refundRefId: 'RRF1', errorReason: '' });

      await expect(provider.refundStatus('RRF1')).resolves.toEqual(expected);
      expect(client.refundStatus).toHaveBeenCalledWith(CREDENTIALS, 'RRF1');
    });

    it('asks again later when the status can not be read', async () => {
      credentials.resolveSslCommerz.mockRejectedValue(new Error('connection terminated'));
      await expect(provider.refundStatus('RRF1')).rejects.toBeInstanceOf(RefundOutcomeUnknownError);
    });
  });
});
