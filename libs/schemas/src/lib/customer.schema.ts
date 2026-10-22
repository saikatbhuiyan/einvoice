import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Model } from 'mongoose';
import { BIN_PATTERN, INVOICE_CONSTRAINTS } from '@libs/shared/types';
import { BASE_SCHEMA_OPTIONS, BaseSchema } from './base.schema';

export const CUSTOMER_CONSTRAINTS = {
  taxId: { maxLength: 64 },
  notes: { maxLength: 1000 },
} as const;

/**
 * Someone an organization invoices. Invoices still embed a *snapshot* of the customer (the legal
 * record of whom it was issued to); editing a customer never changes an issued invoice.
 */
@Schema({ ...BASE_SCHEMA_OPTIONS, collection: 'customers' })
export class Customer extends BaseSchema {
  @Prop({ required: true })
  organizationId!: string;

  @Prop({
    required: true,
    trim: true,
    minlength: INVOICE_CONSTRAINTS.client.name.minLength,
    maxlength: INVOICE_CONSTRAINTS.client.name.maxLength,
  })
  name!: string;

  @Prop({
    required: true,
    trim: true,
    lowercase: true,
    maxlength: INVOICE_CONSTRAINTS.client.email.maxLength,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  })
  email!: string;

  @Prop({
    required: true,
    trim: true,
    minlength: INVOICE_CONSTRAINTS.client.address.minLength,
    maxlength: INVOICE_CONSTRAINTS.client.address.maxLength,
  })
  address!: string;

  @Prop({ trim: true, maxlength: CUSTOMER_CONSTRAINTS.taxId.maxLength })
  taxId?: string;

  /** Bangladesh BIN of a registered buyer; copied onto each invoice billed to this customer. */
  @Prop({ type: String, default: undefined, match: [BIN_PATTERN, 'bin must be exactly 13 digits.'] })
  bin?: string;

  @Prop({ trim: true, maxlength: CUSTOMER_CONSTRAINTS.notes.maxLength })
  notes?: string;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export type CustomerDocument = HydratedDocument<Customer>;
export type CustomerModel = Model<Customer>;
export const CustomerSchema = SchemaFactory.createForClass(Customer);

// One live customer per email per organization; a deleted one doesn't block re-adding it.
CustomerSchema.index({ organizationId: 1, email: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
CustomerSchema.index({ organizationId: 1, deletedAt: 1, name: 1 });

export const CustomerModelName = Customer.name;
export const CUSTOMER_MODEL_DEFINITION = { name: CustomerModelName, schema: CustomerSchema };
