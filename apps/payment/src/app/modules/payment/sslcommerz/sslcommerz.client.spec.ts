import {
  SslCommerzClient,
  SslCommerzRejectedError,
  SslCommerzUnavailableError,
  type SessionRequest,
} from './sslcommerz.client';

const SANDBOX = { storeId: 'testbox', storePassword: 'qwerty', sandbox: true };
const LIVE = { ...SANDBOX, sandbox: false };

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const SESSION: SessionRequest = {
  tranId: 'einv0123456789abcdef0123456789',
  totalAmount: '1380.50',
  currency: 'BDT',
  successUrl: 'https://api.example.com/api/v1/payments/sslcommerz/return/success',
  failUrl: 'https://api.example.com/api/v1/payments/sslcommerz/return/fail',
  cancelUrl: 'https://api.example.com/api/v1/payments/sslcommerz/return/cancel',
  ipnUrl: 'https://api.example.com/api/v1/payments/sslcommerz/ipn',
  productName: 'Invoice INV-2026-000017',
  customer: { name: 'Dhaka Traders Ltd', email: 'ap@dhaka.test' },
  valueA: 'invoice-1',
};

describe('SslCommerzClient', () => {
  let http: jest.Mock;
  let client: SslCommerzClient;

  beforeEach(() => {
    http = jest.fn();
    client = new SslCommerzClient(http as unknown as typeof fetch);
  });

  describe('createSession', () => {
    it('posts the documented form to the sandbox or live host, and returns the gateway page', async () => {
      http.mockReturnValue(
        json({
          status: 'SUCCESS',
          sessionkey: 'KEY1',
          GatewayPageURL: 'https://sandbox.sslcommerz.com/EasyCheckOut/x',
        }),
      );

      await expect(client.createSession(SANDBOX, SESSION)).resolves.toEqual({
        sessionKey: 'KEY1',
        gatewayUrl: 'https://sandbox.sslcommerz.com/EasyCheckOut/x',
      });

      const [url, init] = http.mock.calls[0];
      expect(url).toBe('https://sandbox.sslcommerz.com/gwprocess/v4/api.php');
      const form = Object.fromEntries(init.body as URLSearchParams);
      expect(form).toEqual({
        store_id: 'testbox',
        store_passwd: 'qwerty',
        total_amount: '1380.50',
        currency: 'BDT',
        tran_id: SESSION.tranId,
        success_url: SESSION.successUrl,
        fail_url: SESSION.failUrl,
        cancel_url: SESSION.cancelUrl,
        ipn_url: SESSION.ipnUrl,
        cus_name: 'Dhaka Traders Ltd',
        cus_email: 'ap@dhaka.test',
        shipping_method: 'NO',
        product_name: 'Invoice INV-2026-000017',
        product_category: 'Invoice',
        product_profile: 'non-physical-goods',
        value_a: 'invoice-1',
      });
      // Nothing invented: no phone, address, city or postcode we don't have.
      expect(form).not.toHaveProperty('cus_phone');
      expect(form).not.toHaveProperty('cus_city');

      http.mockReturnValue(
        json({ status: 'SUCCESS', sessionkey: 'K', GatewayPageURL: 'https://securepay.sslcommerz.com/x' }),
      );
      await client.createSession(LIVE, {
        ...SESSION,
        customer: { ...SESSION.customer, phone: '+880 1711-111111', address: 'Tejgaon, Dhaka' },
      });
      expect(http.mock.calls[1][0]).toBe('https://securepay.sslcommerz.com/gwprocess/v4/api.php');
      expect(Object.fromEntries(http.mock.calls[1][1].body as URLSearchParams)).toMatchObject({
        cus_phone: '+880 1711-111111',
        cus_add1: 'Tejgaon, Dhaka',
      });
    });

    it("turns SSLCommerz's refusal into a rejection naming its reason", async () => {
      http.mockReturnValue(json({ status: 'FAILED', failedreason: 'Store Credential Error Or Store is De-active' }));

      await expect(client.createSession(SANDBOX, SESSION)).rejects.toThrow(
        new SslCommerzRejectedError(
          'SSLCommerz refused the payment session: Store Credential Error Or Store is De-active.',
        ),
      );
    });

    it.each([
      ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
      ['an HTTP error', () => json({}, 502)],
      ['a non-JSON answer', () => Promise.resolve(new Response('<html>maintenance</html>', { status: 200 }))],
    ])('treats %s as unavailable (retry later)', async (_label, answer) => {
      http.mockImplementation(answer);

      await expect(client.createSession(SANDBOX, SESSION)).rejects.toBeInstanceOf(SslCommerzUnavailableError);
    });
  });

  describe('queryTransaction', () => {
    it('lists every attempt for the tran_id', async () => {
      http.mockReturnValue(
        json({
          APIConnect: 'DONE',
          no_of_trans_found: 2,
          element: [
            { status: 'FAILED', val_id: '' },
            { status: 'VALID', val_id: 'VAL1' },
          ],
        }),
      );

      await expect(client.queryTransaction(SANDBOX, 'einv1')).resolves.toEqual([
        { status: 'FAILED', valId: '' },
        { status: 'VALID', valId: 'VAL1' },
      ]);
      expect(http.mock.calls[0][0]).toBe(
        'https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php?tran_id=einv1&store_id=testbox&store_passwd=qwerty&format=json',
      );
    });

    // As probed: wrong credentials give APIConnect FAILED; an unknown tran_id gives one INVALID element.
    it('distinguishes refused credentials from an outage', async () => {
      http.mockReturnValue(json({ APIConnect: 'FAILED', no_of_trans_found: 0, element: [] }));
      await expect(client.queryTransaction(SANDBOX, 'einv1')).rejects.toBeInstanceOf(SslCommerzRejectedError);

      http.mockReturnValue(json({ APIConnect: 'INACTIVE' }));
      await expect(client.queryTransaction(SANDBOX, 'einv1')).rejects.toBeInstanceOf(SslCommerzUnavailableError);
    });
  });

  describe('validate', () => {
    it("reads the order's own amount and currency (before any conversion to BDT)", async () => {
      http.mockReturnValue(
        json({
          status: 'VALID',
          tran_id: 'einv1',
          val_id: 'VAL1',
          amount: '165610.00',
          currency: 'BDT',
          currency_type: 'USD',
          currency_amount: '1380.50',
          risk_level: '0',
          risk_title: 'Safe',
          discount_amount: '0.00',
        }),
      );

      await expect(client.validate(SANDBOX, 'VAL1')).resolves.toEqual({
        status: 'VALID',
        tranId: 'einv1',
        valId: 'VAL1',
        amount: '1380.50',
        currency: 'USD',
        riskLevel: '0',
        riskTitle: 'Safe',
        discountAmount: '0.00',
      });
      expect(http.mock.calls[0][0]).toContain('/validator/api/validationserverAPI.php?val_id=VAL1&');
    });
  });

  describe('checkCredentials', () => {
    it('is true when SSLCommerz accepts them, false when it refuses them', async () => {
      http.mockReturnValue(json({ APIConnect: 'DONE', no_of_trans_found: 0, element: [{ status: 'INVALID' }] }));
      await expect(client.checkCredentials(SANDBOX)).resolves.toBe(true);

      http.mockReturnValue(json({ APIConnect: 'FAILED', element: [] }));
      await expect(client.checkCredentials(SANDBOX)).resolves.toBe(false);
    });

    it('lets an outage through rather than calling the credentials wrong', async () => {
      http.mockRejectedValue(new TypeError('fetch failed'));

      await expect(client.checkCredentials(SANDBOX)).rejects.toBeInstanceOf(SslCommerzUnavailableError);
    });
  });
});
