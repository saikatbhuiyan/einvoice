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
import { MoneyError, computeLine, sumAmounts } from '@libs/money';

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

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
   * Derived totals, in the currency's minor units (exact integers): the sums of the line amounts.
   * netMinor was `subtotal`, vatMinor `vatTotal`, totalMinor `total` (the API keeps those names).
   */
  @Prop({ required: true, min: 0, default: 0 })
  netMinor!: number;

  @Prop({ required: true, min: 0, default: 0 })
  sdMinor!: number;

  @Prop({ required: true, min: 0, default: 0 })
  vatMinor!: number;

  @Prop({ required: true, min: 0, default: 0 })
  totalMinor!: number;

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

  /** Payment reminders actually emailed for this invoice (see the overdue scheduler). */
  @Prop({ required: true, min: 0, default: 0 })
  remindersSent!: number;

  @Prop({ type: Date, default: null })
  lastReminderAt?: Date | null;

  /**
   * When the next reminder is due (`dueDate + one of the organization's offsets`), or null when none
   * is scheduled. Set when the invoice turns overdue and after each reminder; the scheduler sends a
   * reminder by a conditional update on this exact value, so it is also the reminder's identity.
   */
  @Prop({ type: Date, default: null })
  nextReminderAt?: Date | null;

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

  // Exact integer arithmetic, half-up per line; totals are the sums of the lines (@libs/money).
  // A line too large or too precise to compute exactly is invalid input (422), not a server error.
  try {
    const lines = (invoice.items ?? []).map((item) => {
      const amounts = computeLine({
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        vatRate: item.vatRate,
        sdRate: item.sdRate,
      });
      Object.assign(item, amounts);
      return amounts;
    });
    Object.assign(invoice, sumAmounts(lines));
  } catch (error) {
    if (!(error instanceof MoneyError)) throw error;
    invoice.invalidate('items', error.message);
  }

  // Compared as calendar days: a due date is a date (midnight UTC of the due day) while issueDate is
  // an instant (it defaults to now), so comparing instants would reject an invoice due today.
  if (invoice.dueDate && invoice.issueDate && invoice.dueDate < startOfUtcDay(invoice.issueDate)) {
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
// The overdue scheduler's two scans run across organizations (system work), so these don't lead with
// organizationId. Partial: only issued invoices can turn overdue, only scheduled reminders are due.
InvoiceSchema.index({ status: 1, dueDate: 1 }, { partialFilterExpression: { status: 'issued' } });
InvoiceSchema.index(
  { status: 1, nextReminderAt: 1 },
  { partialFilterExpression: { status: 'overdue', nextReminderAt: { $type: 'date' } } },
);

export const InvoiceModelName = Invoice.name;

export const INVOICE_MODEL_DEFINITION: ModelDefinition = {
  name: InvoiceModelName,
  schema: InvoiceSchema,
};

export type InvoiceModel = Model<Invoice>;
