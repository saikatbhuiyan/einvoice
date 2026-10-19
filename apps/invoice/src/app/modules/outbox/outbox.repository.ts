import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession } from 'mongoose';
import { OutboxEventModelName, type OutboxEventDocument, type OutboxEventModel } from '@libs/schemas';
import { createRpcEnvelope } from '@libs/transports';

export interface OutboxMessage<TData extends object> {
  topic: string;
  /** Kafka key: the aggregate id, so one aggregate's events stay ordered on one partition. */
  key: string;
  data: TData;
}

/** Long enough to diagnose, short enough not to bloat the row (a Kafka error can be a stack). */
const MAX_ERROR_LENGTH = 1000;

@Injectable()
export class OutboxRepository {
  constructor(@InjectModel(OutboxEventModelName) private readonly model: OutboxEventModel) {}

  /**
   * Writes the event inside the caller's transaction -- it is published only if that transaction
   * commits. The envelope (with the current request's correlation/trace ids and identity) is built
   * now, at the moment the event happened, not when the relay later publishes it. Returns the event
   * id, which is also stamped into the payload as `eventId` for consumers to dedupe on.
   */
  async enqueue<TData extends object>(
    session: ClientSession,
    message: OutboxMessage<TData>,
    sourceService: string,
  ): Promise<string> {
    const _id = new Types.ObjectId();
    const eventId = _id.toHexString();
    const value = createRpcEnvelope({ ...message.data, eventId }, sourceService);

    // JSON round-trip: what's stored is exactly what goes on the wire (JSON.stringify drops
    // undefined-valued keys, e.g. an optional dueDate), so a stored row never differs from the
    // published message.
    await this.model.create(
      [{ _id, topic: message.topic, key: message.key, value: JSON.parse(JSON.stringify(value)) }],
      { session },
    );
    return eventId;
  }

  /** Oldest first, so per-aggregate order is preserved across batches. */
  findUnpublished(limit: number): Promise<OutboxEventDocument[]> {
    return this.model.find({ publishedAt: null }).sort({ _id: 1 }).limit(limit).exec();
  }

  async markPublished(id: Types.ObjectId): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { publishedAt: new Date(), lastError: null } }).exec();
  }

  async markFailed(id: Types.ObjectId, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.model
      .updateOne({ _id: id }, { $inc: { attempts: 1 }, $set: { lastError: message.slice(0, MAX_ERROR_LENGTH) } })
      .exec();
  }

  /** Age of the oldest unpublished event, or 0 when caught up -- the relay's lag. */
  async oldestUnpublishedAgeSeconds(now = new Date()): Promise<number> {
    const oldest = await this.model.findOne({ publishedAt: null }).sort({ _id: 1 }).select({ createdAt: 1 }).lean();
    return oldest ? Math.max(0, (now.getTime() - oldest.createdAt.getTime()) / 1000) : 0;
  }
}
