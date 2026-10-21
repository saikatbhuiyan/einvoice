import { createServer } from 'net';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import Redis from 'ioredis';
import { Kafka, logLevel, type Consumer } from 'kafkajs';
import mongoose, { type Connection } from 'mongoose';
import {
  InvoiceModelName,
  InvoiceSchema,
  OutboxEventModelName,
  OutboxEventSchema,
  type InvoiceModel,
  type OutboxEventModel,
} from '@libs/schemas';
import { INVOICE_EVENTS_TOPIC } from '@libs/transports';
import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
import { InvoiceRepository } from '../invoice/invoice.repository';
import type { NewInvoice } from '../invoice/invoice.repository.interface';
import { InvoiceEventsProducerService } from '../invoice/clients/invoice-events-producer.service';
import { OutboxRepository } from './outbox.repository';
import { KafkaOutboxPublisher } from './outbox-publisher';
import { OutboxRelay, type OutboxRelayOptions } from './outbox-relay.service';

/**
 * Integration test: the transactional outbox against a real MongoDB replica set (Testcontainers runs
 * one, as dev compose now does), a real Kafka broker (the image dev compose pins) and real Redis
 * (the leader lease). What only real infrastructure shows: that the event commits or rolls back
 * *with* the state change, that the relay's published bytes are the stored row, and that a broker
 * outage loses nothing.
 */
const KAFKA_IMAGE = 'apache/kafka:4.3.1';
const RELAY_OPTIONS: OutboxRelayOptions = { intervalMs: 100, batchSize: 100, leaseMs: 15_000, maxBackoffMs: 1_000 };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port')),
      );
    });
  });
}

describe('transactional outbox (real Mongo replica set, Kafka, Redis)', () => {
  let mongo: StartedMongoDBContainer;
  let redisContainer: StartedRedisContainer;
  let kafkaContainer: StartedTestContainer;
  let connection: Connection;
  let invoiceModel: InvoiceModel;
  let outboxModel: OutboxEventModel;
  let redis: Redis;
  let broker: string;
  let repository: InvoiceRepository;
  let outbox: OutboxRepository;
  let events: InvoiceEventsProducerService;
  const publishers: KafkaOutboxPublisher[] = [];
  const relays: OutboxRelay[] = [];
  let counter = 0;

  beforeAll(async () => {
    // The broker must advertise an address reachable from this (host) process, so the host port is
    // fixed before start rather than assigned after.
    const kafkaPort = await freePort();
    broker = `localhost:${kafkaPort}`;

    [mongo, redisContainer, kafkaContainer] = await Promise.all([
      new MongoDBContainer('mongo:7').start(),
      new RedisContainer('redis:7-alpine').start(),
      new GenericContainer(KAFKA_IMAGE)
        .withExposedPorts({ container: 9092, host: kafkaPort })
        .withEnvironment({
          KAFKA_NODE_ID: '1',
          KAFKA_PROCESS_ROLES: 'broker,controller',
          KAFKA_LISTENERS: 'PLAINTEXT://:9092,CONTROLLER://:9093',
          KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://${broker}`,
          KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
          KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: 'CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT',
          KAFKA_CONTROLLER_QUORUM_VOTERS: '1@localhost:9093',
          KAFKA_INTER_BROKER_LISTENER_NAME: 'PLAINTEXT',
          KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
          KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: '1',
          KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: '1',
          KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: '0',
        })
        .withWaitStrategy(Wait.forLogMessage('Kafka Server started'))
        .withStartupTimeout(120_000)
        .start(),
    ]);

    connection = await mongoose
      .createConnection(mongo.getConnectionString(), { directConnection: true, dbName: 'outbox_int' })
      .asPromise();
    invoiceModel = connection.model(InvoiceModelName, InvoiceSchema) as unknown as InvoiceModel;
    outboxModel = connection.model(OutboxEventModelName, OutboxEventSchema) as unknown as OutboxEventModel;
    await Promise.all([invoiceModel.init(), outboxModel.init()]);

    redis = new Redis(redisContainer.getConnectionUrl());
    repository = new InvoiceRepository(invoiceModel, invoiceModel);
    outbox = new OutboxRepository(outboxModel);
    events = new InvoiceEventsProducerService(outbox);

    const admin = new Kafka({ clientId: 'outbox-int-admin', brokers: [broker], logLevel: logLevel.NOTHING }).admin();
    await admin.connect();
    await admin.createTopics({ topics: [{ topic: INVOICE_EVENTS_TOPIC, numPartitions: 1 }], waitForLeaders: true });
    await admin.disconnect();
  }, 180_000);

  afterAll(async () => {
    for (const relay of relays) await relay.onApplicationShutdown();
    for (const publisher of publishers) await publisher.onApplicationShutdown();
    redis?.disconnect();
    await connection?.close();
    await Promise.all([kafkaContainer?.stop(), redisContainer?.stop(), mongo?.stop()]);
  });

  beforeEach(async () => {
    await Promise.all([invoiceModel.deleteMany({}), outboxModel.deleteMany({}), redis.flushall()]);
  });

  const payload = (): NewInvoice =>
    ({
      reference: `OBX-${++counter}`,
      client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Main St' },
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPriceMinor: 10_000, vatRate: 0, sdRate: 0 }],
      currency: 'USD',
    }) as NewInvoice;

  const issue = (id: string) =>
    repository.transitionStatus(id, ['draft'], 'issued', { prepare: async () => ({ invoiceNumber: `OBX-${id}` }) });

  const newRelay = (brokers: string[]) => {
    const publisher = new KafkaOutboxPublisher(brokers);
    publishers.push(publisher);
    const relay = new OutboxRelay(outbox, publisher, redis, RELAY_OPTIONS);
    relays.push(relay);
    return relay;
  };

  /**
   * Reads the topic from the beginning (fresh consumer group) until every given event has arrived,
   * returning those messages in arrival order. Filtering by eventId keeps tests independent of what
   * earlier tests published to the shared topic.
   */
  async function consumeEvents(eventIds: string[]): Promise<Array<{ key: string; value: Record<string, any> }>> {
    const consumer: Consumer = new Kafka({
      clientId: 'outbox-int',
      brokers: [broker],
      logLevel: logLevel.NOTHING,
    }).consumer({
      groupId: `outbox-int-${Date.now()}-${Math.random()}`,
    });
    await consumer.connect();
    await consumer.subscribe({ topic: INVOICE_EVENTS_TOPIC, fromBeginning: true });
    const wanted = new Set(eventIds);
    const received: Array<{ key: string; value: Record<string, any> }> = [];
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`received ${received.length}/${eventIds.length} expected events`)),
        30_000,
      );
      void consumer.run({
        eachMessage: async ({ message }) => {
          const value = JSON.parse(String(message.value));
          if (!wanted.has(value.data?.eventId)) return;
          received.push({ key: String(message.key), value });
          if (received.length >= eventIds.length) {
            clearTimeout(timeout);
            resolve();
          }
        },
      });
    });
    await consumer.disconnect();
    return received;
  }

  describe('atomicity', () => {
    it('writes the event in the same transaction as the invoice', async () => {
      const invoice = await repository.create(payload(), (created, session) =>
        events.enqueueDemo(session, created._id.toString()).then(() => undefined),
      );

      const rows = await outboxModel.find().lean();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ topic: INVOICE_EVENTS_TOPIC, key: invoice.id, publishedAt: null, attempts: 0 });
      expect(rows[0].value).toMatchObject({
        data: { type: 'invoice.demo', invoiceId: invoice.id, eventId: String(rows[0]._id) },
        // Consumers act on behalf of the organization the event happened in.
        meta: { organizationId: ORG },
      });
    });

    it('rolls the invoice back when its event cannot be written (no invoice without its event)', async () => {
      await expect(
        repository.create(payload(), async (created, session) => {
          await events.enqueueDemo(session, created._id.toString());
          throw new Error('fail after the outbox write');
        }),
      ).rejects.toThrow('fail after the outbox write');

      expect(await invoiceModel.countDocuments()).toBe(0);
      expect(await outboxModel.countDocuments()).toBe(0);
    });

    it('rolls a status change back with its event (no cancelled invoice without invoice.cancelled)', async () => {
      const invoice = await repository.create(payload());
      await issue(invoice.id);

      await expect(
        repository.transitionStatus(invoice.id, ['issued', 'overdue'], 'cancelled', {
          inTransaction: async (cancelled, session) => {
            await events.enqueueCancelled(session, {
              invoiceId: cancelled.id,
              invoiceNumber: cancelled.invoiceNumber as string,
              cancelledAt: new Date().toISOString(),
            });
            throw new Error('fail after the outbox write');
          },
        }),
      ).rejects.toThrow('fail after the outbox write');

      expect((await invoiceModel.findById(invoice.id))?.status).toBe('issued');
      expect(await outboxModel.countDocuments()).toBe(0);
    });
  });

  describe('relay', () => {
    it('publishes committed events to Kafka in order, byte-for-byte as stored, and marks them published', async () => {
      const invoice = await repository.create(payload(), (created, session) =>
        events.enqueueDemo(session, created._id.toString()).then(() => undefined),
      );
      await issue(invoice.id);
      await repository.transitionStatus(invoice.id, ['issued', 'overdue'], 'cancelled', {
        inTransaction: (cancelled, session) =>
          events
            .enqueueCancelled(session, {
              invoiceId: cancelled.id,
              invoiceNumber: cancelled.invoiceNumber as string,
              cancelledAt: '2026-10-19T10:00:00.000Z',
            })
            .then(() => undefined),
      });
      const stored = await outboxModel.find().sort({ _id: 1 }).lean();

      await expect(newRelay([broker]).tick()).resolves.toBe(2);

      const received = await consumeEvents(stored.map((row) => String(row._id)));
      expect(received.map((m) => m.value['data'].type)).toEqual(['invoice.demo', 'invoice.cancelled']);
      expect(received.map((m) => m.key)).toEqual([invoice.id, invoice.id]);
      expect(received.map((m) => m.value)).toEqual(stored.map((row) => row.value));
      const after = await outboxModel.find().lean();
      expect(after.every((row) => row.publishedAt instanceof Date && row.lastError === null)).toBe(true);
    });

    it('loses nothing while Kafka is unreachable, records the failure, and publishes once a broker is back', async () => {
      await repository.create(payload(), (created, session) =>
        events.enqueueDemo(session, created._id.toString()).then(() => undefined),
      );

      // Nothing listens here: the "outage".
      const deadBroker = `127.0.0.1:${await freePort()}`;
      await expect(newRelay([deadBroker]).tick()).rejects.toThrow(/Publishing outbox event/);

      const failed = await outboxModel.findOne().lean();
      expect(failed).toMatchObject({ publishedAt: null, attempts: 1 });
      expect(failed?.lastError).toEqual(expect.any(String));

      // The failed relay released nothing to anyone else yet; take its lease over, as a restarted
      // instance would once it expires.
      await redis.flushall();
      await expect(newRelay([broker]).tick()).resolves.toBe(1);
      const received = await consumeEvents([String(failed?._id)]);
      expect(received[0].value).toEqual(failed?.value);
    }, 60_000);

    it('lets only the lease holder publish', async () => {
      await repository.create(payload(), (created, session) =>
        events.enqueueDemo(session, created._id.toString()).then(() => undefined),
      );
      const [first, second] = [newRelay([broker]), newRelay([broker])];

      await expect(first.tick()).resolves.toBe(1);
      await expect(second.tick()).resolves.toBe(0);

      expect(await redis.pttl('svc:outbox:relay:leader')).toBeGreaterThan(0);
    });
  });
});
