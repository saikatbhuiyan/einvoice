import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { EMBEDDED_SCHEMA_OPTIONS } from './base.schema';

@Schema(EMBEDDED_SCHEMA_OPTIONS)
export class ClientSnapshot {
  @Prop({
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 120,
  })
  name!: string;

  @Prop({
    required: true,
    trim: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  })
  email!: string;

  @Prop({
    required: true,
    trim: true,
    minlength: 5,
    maxlength: 300,
  })
  address?: string;
}

export const ClientSnapshotSchema = SchemaFactory.createForClass(ClientSnapshot);
