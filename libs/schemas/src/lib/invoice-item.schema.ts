import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { INVOICE_CONSTRAINTS } from '@libs/shared/types';
import { EMBEDDED_SCHEMA_OPTIONS } from './base.schema';

@Schema(EMBEDDED_SCHEMA_OPTIONS)
export class InvoiceItem {
  @Prop({
    required: true,
    trim: true,
    minlength: INVOICE_CONSTRAINTS.item.catalogId.minLength,
    maxlength: INVOICE_CONSTRAINTS.item.catalogId.maxLength,
  })
  catalogId!: string;

  @Prop({
    required: true,
    trim: true,
    minlength: INVOICE_CONSTRAINTS.item.name.minLength,
    maxlength: INVOICE_CONSTRAINTS.item.name.maxLength,
  })
  name!: string;

  @Prop({
    required: true,
    min: INVOICE_CONSTRAINTS.item.quantity.min,
    max: INVOICE_CONSTRAINTS.item.quantity.max,
  })
  quantity!: number;

  @Prop({
    required: true,
    min: INVOICE_CONSTRAINTS.item.unitPrice.min,
    max: INVOICE_CONSTRAINTS.item.unitPrice.max,
  })
  unitPrice!: number;

  @Prop({
    required: true,
    min: INVOICE_CONSTRAINTS.item.vatRate.min,
    max: INVOICE_CONSTRAINTS.item.vatRate.max,
  })
  vatRate!: number;

  /**
   * Derived field. Recalculated from quantity, unitPrice, and vatRate.
   */
  @Prop({ required: true, min: 0, default: 0 })
  total!: number;
}

export const InvoiceItemSchema = SchemaFactory.createForClass(InvoiceItem);
