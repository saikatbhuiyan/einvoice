import { readFileSync } from 'fs';
import { join } from 'path';
import type { ClientKafka } from '@nestjs/microservices';
import { runWithCorrelationContext } from '@libs/logging';
import { INVOICE_EVENTS_TOPIC } from '@libs/transports';
import { InvoiceEventsProducerService } from './invoice-events-producer.service';

/**
 * Producer half of the invoice.events contract with services/mail (Go). The fixtures are the
 * exact wire values the Go consumer's contract_test.go decodes; this asserts the real producer
 * emits exactly them. See libs/transports/src/contracts/kafka/README.md.
 */
const FIXTURES = join(__dirname, '../../../../../../../libs/transports/src/contracts/kafka');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, any>;

const IDENTITY = {
  correlationId: 'corr-contract-1',
  traceId: 'trace-contract-1',
  userId: 'user-1',
  roles: ['accountant'],
  permissions: ['invoice:write'],
};

describe('invoice.events producer contract', () => {
  let emit: jest.Mock;
  let producer: InvoiceEventsProducerService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-16T09:00:00.000Z') });
    emit = jest.fn();
    producer = new InvoiceEventsProducerService({ emit } as unknown as ClientKafka);
  });

  afterEach(() => jest.useRealTimers());

  // What actually reaches the broker: kafkajs serializes the value with JSON.stringify, which
  // drops undefined-valued keys — the same thing the Go side will see.
  const emitted = () => {
    const [topic, message] = emit.mock.calls[0];
    return { topic, key: message.key, value: JSON.parse(JSON.stringify(message.value)) };
  };

  it('emits invoice.demo exactly as the contract fixture', () => {
    const expected = fixture('invoice.demo.json');

    runWithCorrelationContext(IDENTITY, () => producer.emitDemo(expected['data'].invoiceId));

    expect(emitted()).toEqual({ topic: INVOICE_EVENTS_TOPIC, key: expected['data'].invoiceId, value: expected });
  });

  it('emits invoice.pdf.generated exactly as the contract fixture', () => {
    const expected = fixture('invoice.pdf.generated.json');
    const { type, ...payload } = expected['data'];

    runWithCorrelationContext(IDENTITY, () => producer.emitPdfGenerated(payload));

    expect(type).toBe('invoice.pdf.generated');
    expect(emitted()).toEqual({ topic: INVOICE_EVENTS_TOPIC, key: payload.invoiceId, value: expected });
  });

  it('omits dueDate from the wire entirely when the invoice has none', () => {
    const expected = fixture('invoice.pdf.generated.no-due-date.json');
    const { type, ...payload } = expected['data'];

    runWithCorrelationContext(IDENTITY, () => producer.emitPdfGenerated({ ...payload, dueDate: undefined }));

    expect(type).toBe('invoice.pdf.generated');
    expect(emitted().value).toEqual(expected);
    expect('dueDate' in emitted().value.data).toBe(false);
  });
});
