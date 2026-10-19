import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheModule } from '@libs/cache';
import { OUTBOX_EVENT_MODEL_DEFINITION } from '@libs/schemas';
import { kafkaBrokers } from '@libs/transports';
import { OutboxRepository } from './outbox.repository';
import { KafkaOutboxPublisher, OUTBOX_PUBLISHER } from './outbox-publisher';
import { DEFAULT_OUTBOX_RELAY_OPTIONS, OUTBOX_RELAY_OPTIONS, OutboxRelay } from './outbox-relay.service';

/**
 * Transactional outbox for invoice's domain events. Registered on the default (primary) connection
 * only: outbox rows are written inside write transactions and the relay must read what was just
 * committed, never a lagging replica.
 */
@Module({
  imports: [
    MongooseModule.forFeature([OUTBOX_EVENT_MODEL_DEFINITION]),
    // Memoized per prefix: this is the same module instance (and Redis connection) InvoiceModule uses.
    CacheModule.forRoot('svc'),
  ],
  providers: [
    OutboxRepository,
    OutboxRelay,
    { provide: OUTBOX_PUBLISHER, useFactory: () => new KafkaOutboxPublisher(kafkaBrokers()) },
    { provide: OUTBOX_RELAY_OPTIONS, useValue: DEFAULT_OUTBOX_RELAY_OPTIONS },
  ],
  exports: [OutboxRepository],
})
export class OutboxModule {}
