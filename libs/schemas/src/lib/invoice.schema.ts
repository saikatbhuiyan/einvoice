import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ModelDefinition } from '@nestjs/mongoose/dist/interfaces/model-definition.interface';
import { HydratedDocument, Model } from 'mongoose';
import { BASE_SCHEMA_OPTIONS, BaseSchema } from './base.schema';
import { ClientSnapshotSchema, ClientSnapshot } from './client-snapshot.schema';
import { InvoiceItemSchema, InvoiceItem } from './invoice-item.schema';
import {
  INVOICE_CONSTRAINTS,
  INVOICE_STATUSES,
  InvoiceStatus,
  SUPPORTED_CURRENCIES,
  SupportedCurrency,
} from '@libs/shared/types';

const roundCurrency = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export { INVOICE_STATUSES, SUPPORTED_CURRENCIES };
export type { InvoiceStatus, SupportedCurrency };

@Schema(BASE_SCHEMA_OPTIONS)
export class Invoice extends BaseSchema {
  @Prop({
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    minlength: INVOICE_CONSTRAINTS.invoiceNumber.minLength,
    maxlength: INVOICE_CONSTRAINTS.invoiceNumber.maxLength,
  })
  invoiceNumber!: string;

  /**
   * Embedded snapshot by design:
   * invoice should preserve client details as they were at issue time.
   */
  @Prop({ type: ClientSnapshotSchema, required: true })
  client!: ClientSnapshot;

  @Prop({
    type: [InvoiceItemSchema],
    required: true,
    validate: {
      validator: (items: InvoiceItem[]) => Array.isArray(items) && items.length > 0,
      message: 'Invoice must contain at least one item.',
    },
  })
  items!: InvoiceItem[];

  @Prop({
    required: true,
    enum: SUPPORTED_CURRENCIES,
    uppercase: true,
    trim: true,
  })
  currency!: SupportedCurrency;

  @Prop({
    required: true,
    enum: INVOICE_STATUSES,
    default: 'draft',
    index: true,
  })
  status!: InvoiceStatus;

  @Prop({ required: true, default: Date.now, index: true })
  issueDate!: Date;

  @Prop()
  dueDate?: Date;

  @Prop({ trim: true, maxlength: INVOICE_CONSTRAINTS.notes.maxLength })
  notes?: string;

  /**
   * Derived totals
   */
  @Prop({ required: true, min: 0, default: 0 })
  subtotal!: number;

  @Prop({ required: true, min: 0, default: 0 })
  vatTotal!: number;

  @Prop({ required: true, min: 0, default: 0 })
  total!: number;
}

export type InvoiceDocument = HydratedDocument<Invoice>;

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);

/**
 * Recalculate all derived monetary values before validation.
 */
InvoiceSchema.pre('validate', function recalculateTotals() {
  const invoice = this as InvoiceDocument;

  let subtotal = 0;
  let vatTotal = 0;

  for (const item of invoice.items ?? []) {
    const lineSubtotal = roundCurrency(item.quantity * item.unitPrice);
    const lineVat = roundCurrency((lineSubtotal * item.vatRate) / 100);
    const lineTotal = roundCurrency(lineSubtotal + lineVat);

    item.total = lineTotal;

    subtotal += lineSubtotal;
    vatTotal += lineVat;
  }

  invoice.subtotal = roundCurrency(subtotal);
  invoice.vatTotal = roundCurrency(vatTotal);
  invoice.total = roundCurrency(invoice.subtotal + invoice.vatTotal);

  if (invoice.dueDate && invoice.issueDate && invoice.dueDate < invoice.issueDate) {
    invoice.invalidate('dueDate', 'dueDate cannot be earlier than issueDate.');
  }
});

export const InvoiceModelName = Invoice.name;

export const INVOICE_MODEL_DEFINITION: ModelDefinition = {
  name: InvoiceModelName,
  schema: InvoiceSchema,
};

export type InvoiceModel = Model<Invoice>;
