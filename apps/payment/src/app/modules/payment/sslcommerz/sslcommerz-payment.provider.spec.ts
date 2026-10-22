import { ServiceUnavailableException } from '@nestjs/common';
import { SslCommerzPaymentProvider } from './sslcommerz-payment.provider';

const CREDENTIALS = { storeId: 'testbox', storePassword: 'qwerty', sandbox: true };

describe('SslCommerzPaymentProvider', () => {
  let credentials: { resolveSslCommerz: jest.Mock };
  let client: { createSession: jest.Mock; queryTransaction: jest.Mock; validate: jest.Mock };
  let provider: SslCommerzPaymentProvider;

  beforeEach(() => {
    credentials = { resolveSslCommerz: jest.fn().mockResolvedValue(CREDENTIALS) };
    client = { createSession: jest.fn(), queryTransaction: jest.fn(), validate: jest.fn() };
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
});
