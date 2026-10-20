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
  /** The tenant this invoice belongs to. Every query is scoped by it (InvoiceRepository.activeFilter). */
  @Prop({ required: true })
  organizationId!: string;

  /**
   * Assigned by the server when the invoice is issued -- `{prefix}-{year}-{seq}`, gapless per
   * organization and year (see InvoiceService.issue). Drafts have none. Unique per organization.
   */
  @Prop({
    trim: true,
    uppercase: true,
    minlength: INVOICE_CONSTRAINTS.invoiceNumber.minLength,
    maxlength: INVOICE_CONSTRAINTS.invoiceNumber.maxLength,
  })
  invoiceNumber?: string;

  /** The client's own reference for this invoice (a purchase-order number, etc.). Free text. */
  @Prop({ trim: true, maxlength: INVOICE_CONSTRAINTS.reference.maxLength })
  reference?: string;

  /** The customer record the client snapshot was taken from, if any (null for one-off clients). */
  @Prop({ type: String, default: null })
  customerId?: string | null;

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
    type: String,
    required: true,
    enum: SUPPORTED_CURRENCIES,
    uppercase: true,
    trim: true,
  })
  currency!: SupportedCurrency;

  @Prop({
    type: String,
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

  /** Soft-delete timestamp. Null = active record. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  /**
   * S3 key of the last PDF rendered for this invoice (see InvoiceService.generatePdf/send). The
   * bucket is private: this is never a URL -- downloads go through short-lived presigned URLs
   * (InvoiceService.getPdfDownloadUrl). Overwritten by the next render.
   *
   * Replaced `pdfUrl` (a permanent public object URL); documents written before that change are
   * converted by apps/invoice/src/database/scripts/backfill-pdf-keys.ts.
   */
  @Prop()
  pdfKey?: string;

  @Prop()
  pdfGeneratedAt?: Date;

  /**
   * Client-supplied idempotency key for safe retry semantics.
   * Sparse unique index ensures collisions only for actual keys,
   * not for the default null/absent value.
   */
  @Prop({ type: String, trim: true })
  idempotencyKey?: string | null;
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

// Tenancy: every index leads with organizationId, and the unique ones are unique *per organization*.
// Partial (not sparse) for compound indexes: only numbered invoices / keyed creates take part.
InvoiceSchema.index(
  { organizationId: 1, invoiceNumber: 1 },
  { unique: true, partialFilterExpression: { invoiceNumber: { $type: 'string' } } },
);
InvoiceSchema.index(
  { organizationId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
InvoiceSchema.index({ organizationId: 1, deletedAt: 1, issueDate: -1, createdAt: -1 });
InvoiceSchema.index({ organizationId: 1, customerId: 1 });

export const InvoiceModelName = Invoice.name;

export const INVOICE_MODEL_DEFINITION: ModelDefinition = {
  name: InvoiceModelName,
  schema: InvoiceSchema,
};

export type InvoiceModel = Model<Invoice>;
