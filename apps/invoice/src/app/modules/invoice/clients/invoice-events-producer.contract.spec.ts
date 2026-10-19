import { readFileSync } from 'fs';
import { join } from 'path';
import type { ClientSession, Types } from 'mongoose';
import type { OutboxEventModel } from '@libs/schemas';
import { runWithCorrelationContext } from '@libs/logging';
import { INVOICE_EVENTS_TOPIC } from '@libs/transports';
import { OutboxRepository } from '../../outbox/outbox.repository';
import { InvoiceEventsProducerService } from './invoice-events-producer.service';

/**
 * Producer half of the invoice.events contract with services/mail (Go) and payment. The fixtures are
 * the exact wire values the consumers' contract tests decode; this asserts the real producer, through
 * the real outbox repository, stores exactly them -- the outbox row's `value` is published verbatim.
 * See libs/transports/src/contracts/kafka/README.md.
 */
const FIXTURES = join(__dirname, '../../../../../../../libs/transports/src/contracts/kafka');
// Fixtures are arbitrary JSON; `any` keeps the property access in assertions readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Json;

/** The producer's input: the fixture's event minus what the producer/outbox add (type, eventId). */
const producerPayload = (expected: Json) => {
  const payload = { ...expected['data'] };
  delete payload.type;
  delete payload.eventId;
  return payload;
};

const IDENTITY = {
  correlationId: 'corr-contract-1',
  traceId: 'trace-contract-1',
  userId: 'user-1',
  roles: ['accountant'],
  permissions: ['invoice:write'],
};

interface StoredRow {
  _id: Types.ObjectId;
  topic: string;
  key: string;
  value: Json;
}

describe('invoice.events producer contract (via the outbox)', () => {
  let create: jest.Mock;
  let producer: InvoiceEventsProducerService;
  const session = {} as ClientSession;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-16T09:00:00.000Z') });
    create = jest.fn().mockResolvedValue([]);
    producer = new InvoiceEventsProducerService(new OutboxRepository({ create } as unknown as OutboxEventModel));
  });

  afterEach(() => jest.useRealTimers());

  const stored = (): StoredRow => {
    const [[rows, options]] = create.mock.calls;
    expect(options).toEqual({ session });
    return rows[0];
  };

  /**
   * The row is the wire message, with the one field the producer generates: `eventId`, which must be
   * the row's own id (consumers dedupe on it; the relay publishes the row it identifies).
   */
  const expectRowToMatch = (row: StoredRow, expected: Json) => {
    expect(row.topic).toBe(INVOICE_EVENTS_TOPIC);
    expect(row.key).toBe(expected['data'].invoiceId);
    expect(row.value['data'].eventId).toBe(row._id.toHexString());
    expect(row.value).toEqual({ ...expected, data: { ...expected['data'], eventId: row._id.toHexString() } });
  };

  it('writes invoice.demo exactly as the contract fixture', async () => {
    const expected = fixture('invoice.demo.json');

    const eventId = await runWithCorrelationContext(IDENTITY, () =>
      producer.enqueueDemo(session, expected['data'].invoiceId),
    );

    expectRowToMatch(stored(), expected);
    expect(eventId).toBe(stored()._id.toHexString());
  });

  it('writes invoice.sent exactly as the contract fixture', async () => {
    const expected = fixture('invoice.sent.json');
    await runWithCorrelationContext(IDENTITY, () => producer.enqueueSent(session, producerPayload(expected)));

    expect(expected['data'].type).toBe('invoice.sent');
    expectRowToMatch(stored(), expected);
  });

  // JSON.stringify drops undefined-valued keys; the stored row must already be the wire shape, so
  // the relay publishes exactly what consumers will decode.
  it('omits dueDate entirely when the invoice has none', async () => {
    const expected = fixture('invoice.sent.no-due-date.json');
    await runWithCorrelationContext(IDENTITY, () =>
      producer.enqueueSent(session, { ...producerPayload(expected), dueDate: undefined }),
    );

    expectRowToMatch(stored(), expected);
    expect('dueDate' in stored().value['data']).toBe(false);
  });

  it('writes invoice.cancelled exactly as the contract fixture', async () => {
    const expected = fixture('invoice.cancelled.json');
    await runWithCorrelationContext(IDENTITY, () => producer.enqueueCancelled(session, producerPayload(expected)));

    expect(expected['data'].type).toBe('invoice.cancelled');
    expectRowToMatch(stored(), expected);
  });
});
