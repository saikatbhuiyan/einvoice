import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { EMBEDDED_SCHEMA_OPTIONS } from './base.schema';

@Schema(EMBEDDED_SCHEMA_OPTIONS)
export class InvoiceItem {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 64 })
  catalogId!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 160 })
  name!: string;

  @Prop({ required: true, min: 1, max: 1_000_000 })
  quantity!: number;

  @Prop({ required: true, min: 0, max: 1_000_000_000 })
  unitPrice!: number;

  @Prop({ required: true, min: 0, max: 100 })
  vatRate!: number;

  /**
   * Derived field. Recalculated from quantity, unitPrice, and vatRate.
   */
  @Prop({ required: true, min: 0, default: 0 })
  total!: number;
}

export const InvoiceItemSchema = SchemaFactory.createForClass(InvoiceItem);
