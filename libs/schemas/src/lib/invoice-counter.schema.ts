import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Model } from 'mongoose';

/**
 * The last invoice number issued for one organization in one year: `_id` is
 * `<organizationId>:<year>`. Incremented inside the issuing transaction, so an issue that aborts
 * gives its number back -- the sequence has no gaps.
 */
@Schema({ collection: 'invoice_counters', versionKey: false })
export class InvoiceCounter {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, default: 0 })
  seq!: number;
}

export type InvoiceCounterDocument = HydratedDocument<InvoiceCounter>;
export type InvoiceCounterModel = Model<InvoiceCounter>;
export const InvoiceCounterSchema = SchemaFactory.createForClass(InvoiceCounter);
export const InvoiceCounterModelName = InvoiceCounter.name;
export const INVOICE_COUNTER_MODEL_DEFINITION = { name: InvoiceCounterModelName, schema: InvoiceCounterSchema };
