import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Kafka, logLevel, type Producer } from 'kafkajs';

export const OUTBOX_PUBLISHER = Symbol('OUTBOX_PUBLISHER');

/** Resolves only once the broker has acknowledged the message; rejects otherwise. */
export interface OutboxPublisher {
  publish(topic: string, key: string, value: Record<string, unknown>): Promise<void>;
}

/**
 * A plain kafkajs producer rather than Nest's ClientKafka (which BaseKafkaProducer wraps): the relay
 * needs an awaited, acknowledged send it can act on -- mark published, or retry -- not
 * fire-and-forget. `idempotent: true` (which implies acks from all in-sync replicas and one
 * in-flight request) means kafkajs's own internal retries can neither duplicate a message on the
 * broker nor reorder two messages for the same key.
 *
 * Wire format is identical to what ClientKafka.emit produced: key = aggregate id, value = the JSON
 * envelope. Provided via a factory (see OutboxModule), not class injection: `brokers` isn't a DI token.
 */
export class KafkaOutboxPublisher implements OutboxPublisher, OnApplicationShutdown {
  private readonly logger = new Logger(KafkaOutboxPublisher.name);
  private readonly producer: Producer;
  private connected: Promise<void> | undefined;

  constructor(brokers: string[]) {
    this.producer = new Kafka({
      clientId: 'invoice-outbox',
      brokers,
      logLevel: logLevel.WARN,
      // Fail a send within ~10s so the relay can record the error and back off, instead of kafkajs
      // retrying a dead broker for minutes inside one publish() call.
      retry: { retries: 3, initialRetryTime: 300, maxRetryTime: 3000 },
      connectionTimeout: 3000,
    }).producer({ idempotent: true, maxInFlightRequests: 1 });
  }

  async publish(topic: string, key: string, value: Record<string, unknown>): Promise<void> {
    await this.connect();
    await this.producer.send({ topic, acks: -1, messages: [{ key, value: JSON.stringify(value) }] });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.connected) await this.producer.disconnect().catch(() => undefined);
  }

  // Lazy, and forgotten on failure, so a broker that was down at startup is retried on the next
  // publish rather than leaving the relay permanently disconnected.
  private connect(): Promise<void> {
    this.connected ??= this.producer.connect().catch((error: unknown) => {
      this.connected = undefined;
      this.logger.warn(`Kafka producer connect failed: ${(error as Error).message}`);
      throw error;
    });
    return this.connected;
  }
}
