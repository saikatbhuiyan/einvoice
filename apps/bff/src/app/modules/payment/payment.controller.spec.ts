import { BadRequestException, ParseEnumPipe } from '@nestjs/common';
import { PaymentController } from './payment.controller';

describe('PaymentController (SSLCommerz routes)', () => {
  let client: { notifySslCommerz: jest.Mock };
  let controller: PaymentController;

  beforeEach(() => {
    client = { notifySslCommerz: jest.fn().mockResolvedValue({ invoiceId: 'invoice-1', status: 'paid' }) };
    controller = new PaymentController(client as never);
  });

  // Everything else SSLCommerz posts (status, amount, val_id...) is ignored: payment asks SSLCommerz itself.
  it('relays only the tran_id of an IPN, and acknowledges it', async () => {
    await expect(
      controller.sslcommerzIpn({ tran_id: 'einv1', status: 'VALID', amount: '999999.00', val_id: 'forged' }),
    ).resolves.toEqual({ received: true });

    expect(client.notifySslCommerz).toHaveBeenCalledWith({ tranId: 'einv1', source: 'ipn' });
  });

  it("relays a payer's return with where it came from, and answers with the outcome", async () => {
    await expect(controller.sslcommerzReturn('success' as never, { tran_id: 'einv1' })).resolves.toEqual({
      invoiceId: 'invoice-1',
      status: 'paid',
    });
    expect(client.notifySslCommerz).toHaveBeenCalledWith({ tranId: 'einv1', source: 'success' });
  });

  it.each([undefined, {}, { tran_id: '' }, { tran_id: 42 }])(
    'refuses a notification without a tran_id: %p',
    async (body) => {
      await expect(controller.sslcommerzIpn(body)).rejects.toThrow(new BadRequestException('Missing "tran_id".'));
      expect(client.notifySslCommerz).not.toHaveBeenCalled();
    },
  );

  it('accepts only success, fail and cancel as return routes', async () => {
    const pipe = new ParseEnumPipe<Record<string, string>>({ success: 'success', fail: 'fail', cancel: 'cancel' });

    await expect(pipe.transform('success' as never, { type: 'param' })).resolves.toBe('success');
    await expect(pipe.transform('paid' as never, { type: 'param' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
