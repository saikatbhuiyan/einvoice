import { Logger, OnModuleInit } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { createRpcEnvelope, type RpcEnvelope } from './rpc-envelope';

/**
 * Same role BaseTcpClient plays for request/response TCP calls, but for fire-and-forget Kafka
 * events: one small base class every producer extends, reusing the same correlation-id/trace-id/
 * identity envelope (createRpcEnvelope) every TCP call already carries. No circuit breaker here --
 * there's no synchronous call to break; a struggling broker just means kafkajs's own internal
 * retry/buffering absorbs it, not something this class needs to react to.
 */
export abstract class BaseKafkaProducer implements OnModuleInit {
  protected abstract readonly logger: Logger;
  protected abstract readonly client: ClientKafka;
  protected readonly sourceService: string = 'unknown';

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('Kafka producer connected');
    } catch (error) {
      this.logger.error('Kafka producer failed to connect', (error as Error).stack);
    }
  }

  /**
   * `key` partitions and orders messages (e.g. by invoiceId) -- Kafka only guarantees ordering
   * within a partition, so events about the same entity need the same key to arrive in order.
   */
  protected emit<TInput>(topic: string, data: TInput, key: string): void {
    const envelope: RpcEnvelope<TInput> = createRpcEnvelope(data, this.sourceService);
    this.client.emit(topic, { key, value: envelope });
  }
}
