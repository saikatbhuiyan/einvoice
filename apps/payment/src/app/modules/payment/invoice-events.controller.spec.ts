import { readFileSync } from 'fs';
import { join } from 'path';
import { InvoiceEventsController } from './invoice-events.controller';
import type { PaymentService } from './payment.service';

/**
 * Consumer half of the invoice.events contract for payment: the golden fixtures are the exact wire
 * values invoice's outbox publishes (asserted on the producer side by
 * invoice-events-producer.contract.spec.ts), fed through this controller as Nest's Kafka transport
 * delivers them -- the message's JSON value (the RpcEnvelope) as the payload.
 */
const FIXTURES = join(__dirname, '../../../../../../libs/transports/src/contracts/kafka');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

describe('InvoiceEventsController (payment consuming invoice.events)', () => {
  let expireOpenSessionForInvoice: jest.Mock;
  let controller: InvoiceEventsController;

  beforeEach(() => {
    expireOpenSessionForInvoice = jest.fn().mockResolvedValue(true);
    controller = new InvoiceEventsController({ expireOpenSessionForInvoice } as unknown as PaymentService);
  });

  it('expires the open checkout session of a cancelled invoice', async () => {
    await controller.handle(fixture('invoice.cancelled.json'));

    expect(expireOpenSessionForInvoice).toHaveBeenCalledWith('6700000000000000000000a1');
  });

  it.each(['invoice.demo.json', 'invoice.sent.json'])('ignores %s', async (name) => {
    await controller.handle(fixture(name));

    expect(expireOpenSessionForInvoice).not.toHaveBeenCalled();
  });

  // Rethrowing is what makes Kafka redeliver (the offset isn't committed) -- e.g. Stripe briefly down.
  it('lets a failure propagate so the event is redelivered', async () => {
    expireOpenSessionForInvoice.mockRejectedValue(new Error('Stripe 503'));

    await expect(controller.handle(fixture('invoice.cancelled.json'))).rejects.toThrow('Stripe 503');
  });
});
