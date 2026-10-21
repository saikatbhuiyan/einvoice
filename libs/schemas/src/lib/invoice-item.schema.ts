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

  /** Set when the line was filled from the product catalog (name, price and rates are its values then). */
  @Prop({ type: String, default: undefined })
  productId?: string;

  /** Unit price in the invoice currency's minor units (poisha, cents): an exact integer. */
  @Prop({
    required: true,
    min: 0,
    validate: { validator: Number.isSafeInteger, message: 'unitPriceMinor must be an integer.' },
  })
  unitPriceMinor!: number;

  @Prop({
    required: true,
    min: INVOICE_CONSTRAINTS.item.vatRate.min,
    max: INVOICE_CONSTRAINTS.item.vatRate.max,
  })
  vatRate!: number;

  /** Supplementary duty rate (Bangladesh); VAT is charged on net + SD. 0 where there is none. */
  @Prop({
    required: true,
    default: 0,
    min: INVOICE_CONSTRAINTS.item.sdRate.min,
    max: INVOICE_CONSTRAINTS.item.sdRate.max,
  })
  sdRate!: number;

  // Derived (the invoice's pre-validate hook, via @libs/money's computeLine), all in minor units.
  @Prop({ required: true, min: 0, default: 0 })
  netMinor!: number;

  @Prop({ required: true, min: 0, default: 0 })
  sdMinor!: number;

  @Prop({ required: true, min: 0, default: 0 })
  vatMinor!: number;

  @Prop({ required: true, min: 0, default: 0 })
  totalMinor!: number;
}

export const InvoiceItemSchema = SchemaFactory.createForClass(InvoiceItem);
