import { Transport, type MicroserviceOptions } from '@nestjs/microservices';

/** The cluster's bootstrap brokers, from KAFKA_BROKERS (comma-separated). */
export function kafkaBrokers(): string[] {
  return (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',').map((broker) => broker.trim());
}

/**
 * A Nest Kafka consumer (`app.connectMicroservice(...)`) for one consumer group. Mirrors
 * createTcpServerConfig's role for TCP. Producing is not done through Nest at all: invoice writes
 * events to a transactional outbox and its relay publishes them with an awaited, acknowledged send.
 *
 * Delivery semantics, as implemented by Nest 11's ServerKafka + kafkajs: the event handler is
 * awaited inside kafkajs's `eachMessage`, and with `autoCommit` an offset is only committed once
 * `eachMessage` resolves. A handler that throws is therefore retried (kafkajs backoff), not skipped
 * -- so handlers must be idempotent, and must swallow only failures retrying can't fix.
 *
 * Nest routes by *topic* (the pattern is the topic name), so one `@EventPattern(topic)` handler
 * receives every event type on that topic and dispatches on `data.type` itself. `data` is the
 * message's JSON value: the RpcEnvelope the producer wrote.
 */
export function createKafkaConsumerConfig(clientId: string, groupId: string): MicroserviceOptions {
  return {
    transport: Transport.KAFKA,
    options: {
      client: { clientId, brokers: kafkaBrokers() },
      consumer: { groupId },
      // Kafka consumers only need to see events from when their group was first created on; earlier
      // history describes state this service never had.
      subscribe: { fromBeginning: false },
      run: { autoCommit: true },
    },
  };
}
