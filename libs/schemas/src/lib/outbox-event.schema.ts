import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Model, Schema as MongooseSchema, Types } from 'mongoose';

/** Published rows are kept this long for debugging/replay, then removed by a TTL index. */
export const OUTBOX_RETENTION_SECONDS = 7 * 24 * 60 * 60;

/**
 * Transactional outbox row: an event written in the same MongoDB transaction as the state change
 * it describes, so the event exists if and only if the change committed. A relay publishes rows to
 * Kafka afterwards and stamps `publishedAt` (see apps/invoice's OutboxRelay).
 *
 * `_id` doubles as the event id consumers dedupe on (its hex string travels in the event payload as
 * `eventId`) and as the publish order: ObjectIds are time-ordered, which is all per-aggregate
 * ordering needs -- events about one invoice are written by sequential requests, not concurrently.
 */
@Schema({ collection: 'outbox', versionKey: false })
export class OutboxEvent {
  _id!: Types.ObjectId;

  @Prop({ required: true })
  topic!: string;

  /** Kafka message key (the aggregate id): keeps one aggregate's events on one partition, in order. */
  @Prop({ required: true })
  key!: string;

  /** The exact message value -- an RpcEnvelope -- serialized as JSON when published. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  value!: Record<string, unknown>;

  @Prop({ required: true, default: () => new Date() })
  createdAt!: Date;

  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  @Prop({ required: true, default: 0 })
  attempts!: number;

  @Prop({ type: String, default: null })
  lastError!: string | null;
}

export type OutboxEventDocument = HydratedDocument<OutboxEvent>;
export type OutboxEventModel = Model<OutboxEvent>;

export const OutboxEventSchema = SchemaFactory.createForClass(OutboxEvent);

// The relay's only query: oldest unpublished first.
OutboxEventSchema.index({ publishedAt: 1, _id: 1 });
// TTL indexes skip documents whose field is null, so unpublished rows are never expired.
OutboxEventSchema.index({ publishedAt: 1 }, { expireAfterSeconds: OUTBOX_RETENTION_SECONDS, name: 'publishedAt_ttl' });

export const OutboxEventModelName = OutboxEvent.name;

export const OUTBOX_EVENT_MODEL_DEFINITION = {
  name: OutboxEventModelName,
  schema: OutboxEventSchema,
};
