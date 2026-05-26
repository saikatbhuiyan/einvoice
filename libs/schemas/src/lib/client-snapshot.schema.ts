import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { INVOICE_CONSTRAINTS } from '@libs/shared/types';
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
}

export const ClientSnapshotSchema = SchemaFactory.createForClass(ClientSnapshot);
