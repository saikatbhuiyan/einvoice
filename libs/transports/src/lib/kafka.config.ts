import { ClientProviderOptions, Transport } from '@nestjs/microservices';

const KAFKA_BROKERS = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',').map((broker) => broker.trim());

/**
 * One Kafka cluster, not one-per-service the way TCP_SERVICES has one host:port per service --
 * so there's no ServiceName-style enum here. `clientId` is the free-form label this instead
 * shares with Kafka itself (shows up in its own broker-side logs/metrics), and the injection
 * token is derived from it so every producer's @Inject() call site stays symmetric with the
 * factory call that registered it, the same relationship TCP_CLIENT_TOKENS has to ServiceName.
 */
export function kafkaClientToken(clientId: string): string {
  return `KAFKA_CLIENT_${clientId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/**
 * Reusable by any NestJS producer, not invoice-specific -- mirrors createTcpClientConfig's role
 * for TCP. ClientKafka requires a consumer `groupId` even for a pure producer (it subscribes
 * internally to support Nest's request-reply pattern); every call site in this codebase uses
 * emit() only (fire-and-forget), never send(), so that reply-topic machinery is configured but
 * never exercised.
 */
export function createKafkaClientConfig(clientId: string): ClientProviderOptions {
  return {
    name: kafkaClientToken(clientId),
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId,
        brokers: KAFKA_BROKERS,
      },
      consumer: {
        groupId: `${clientId}-producer`,
      },
    },
  };
}
