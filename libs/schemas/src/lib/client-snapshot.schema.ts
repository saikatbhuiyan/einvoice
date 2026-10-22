import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BIN_PATTERN, INVOICE_CONSTRAINTS } from '@libs/shared/types';
import { EMBEDDED_SCHEMA_OPTIONS } from './base.schema';

@Schema(EMBEDDED_SCHEMA_OPTIONS)
export class ClientSnapshot {
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
  address?: string;

  /** Billing contact phone; handed to payment gateways that ask for one (SSLCommerz). */
  @Prop({
    type: String,
    default: undefined,
    trim: true,
    match: [INVOICE_CONSTRAINTS.client.phone.pattern, 'phone must be a phone number, e.g. +880 1711-111111.'],
  })
  phone?: string;

  /** Bangladesh BIN of a registered buyer ("BIN of Purchaser" on a Mushak-6.3). */
  @Prop({ type: String, default: undefined, match: [BIN_PATTERN, 'bin must be exactly 13 digits.'] })
  bin?: string;
}

export const ClientSnapshotSchema = SchemaFactory.createForClass(ClientSnapshot);
