import {
  BadRequestException,
  ParseEnumPipe,
  UnprocessableEntityException,
  type ArgumentMetadata,
  type Type,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS_KEY } from '@libs/auth/require-permission.decorator';
import { CreatePaymentLinkDto, RecordPaymentDto, RefundDto } from '@libs/interfaces/gateway';
import { createValidationPipe } from '@libs/shared/utils';
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

describe('PaymentController (payments ledger routes)', () => {
  const reflector = new Reflector();
  const permissionOf = (handler: keyof PaymentController) =>
    reflector.get<string[]>(REQUIRED_PERMISSIONS_KEY, PaymentController.prototype[handler] as () => unknown);

  // payment:* is its own permission: a viewer reads payments, only admin/manager/accountant move money.
  it.each([
    ['createPaymentLink', ['invoice:write']],
    ['listPayments', ['payment:read']],
    ['listAttention', ['payment:read']],
    ['recordPayment', ['payment:write']],
    ['refund', ['payment:write']],
    ['acceptHeld', ['payment:write']],
    ['refuseHeld', ['payment:write']],
  ] as const)('%s requires %p', (handler, permissions) => {
    expect(permissionOf(handler)).toEqual(permissions);
  });

  // The global pipe, exactly as main.ts builds it.
  const pipe = createValidationPipe();
  const validate = (metatype: Type<unknown>, value: unknown) =>
    pipe.transform(value, { type: 'body', metatype } as ArgumentMetadata);

  it('takes a payment link for the whole balance, or a positive part of it with at most two decimals', async () => {
    await expect(validate(CreatePaymentLinkDto, {})).resolves.toEqual({});
    await expect(validate(CreatePaymentLinkDto, { amount: 500000 })).resolves.toEqual({ amount: 500000 });
    await expect(validate(CreatePaymentLinkDto, { amount: 0 })).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(validate(CreatePaymentLinkDto, { amount: 10.005 })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('records only the manual methods, on a real date', async () => {
    const payment = { amount: 380000, method: 'bank_transfer', occurredAt: '2026-10-22', reference: 'DBBL-TT-1' };

    await expect(validate(RecordPaymentDto, payment)).resolves.toMatchObject(payment);
    for (const invalid of [
      { ...payment, method: 'stripe' },
      { ...payment, occurredAt: 'yesterday' },
      { ...payment, amount: -1 },
    ]) {
      await expect(validate(RecordPaymentDto, invalid)).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
  });

  it('refunds one payment entry, with a reason', async () => {
    const refund = { paymentEntryId: '0f6a2b9c-3d4e-4f50-8a1b-2c3d4e5f6a7b', amount: 120, reason: 'Overpaid' };

    await expect(validate(RefundDto, { ...refund, returnedOutsideSystem: true })).resolves.toMatchObject(refund);
    for (const invalid of [
      { ...refund, paymentEntryId: 'pay-1' },
      { ...refund, reason: 'no' },
      { ...refund, returnedOutsideSystem: 'yes' },
    ]) {
      await expect(validate(RefundDto, invalid)).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
  });

  it('passes an optional part amount through, and the whole balance when there is none', async () => {
    const client = { createCheckoutSession: jest.fn().mockResolvedValue({}), refuseHeld: jest.fn() };
    const controller = new PaymentController(client as never);

    await controller.createPaymentLink('inv-1', { amount: 500000 });
    await controller.createPaymentLink('inv-1', undefined);
    await controller.refuseHeld('pay-1', undefined);

    expect(client.createCheckoutSession.mock.calls).toEqual([
      ['inv-1', 500000],
      ['inv-1', undefined],
    ]);
    expect(client.refuseHeld).toHaveBeenCalledWith('pay-1', '');
  });
});
