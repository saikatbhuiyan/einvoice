import 'reflect-metadata';
import { Transport } from '@nestjs/microservices';
import { PATTERN_METADATA, TRANSPORT_METADATA } from '@nestjs/microservices/constants';
import { InvoiceEventsController } from './invoice-events.controller';
import { PaymentRpcController } from './payment-rpc.controller';

/**
 * payment runs two microservice servers -- TCP (bff's RPCs) and Kafka (invoice.events). Nest binds a
 * pattern that names no transport to *every* server, so the Kafka server tried to subscribe to the
 * TCP pattern strings as topics and payment failed to start (found running the stack live). Every
 * handler here must say which transport it belongs to.
 */
const handlers = (controller: { prototype: object }) =>
  Object.getOwnPropertyNames(controller.prototype)
    .map((name) => ({ name, fn: (controller.prototype as Record<string, unknown>)[name] }))
    .filter(({ fn }) => typeof fn === 'function' && Reflect.hasMetadata(PATTERN_METADATA, fn as object));

describe('payment handler transport binding', () => {
  it.each([
    ['PaymentRpcController', PaymentRpcController, Transport.TCP],
    ['InvoiceEventsController', InvoiceEventsController, Transport.KAFKA],
  ] as const)('binds every %s handler to its transport explicitly', (_, controller, transport) => {
    const found = handlers(controller);

    expect(found.length).toBeGreaterThan(0);
    for (const { name, fn } of found) {
      expect({ handler: name, transport: Reflect.getMetadata(TRANSPORT_METADATA, fn as object) }).toEqual({
        handler: name,
        transport,
      });
    }
  });
});
