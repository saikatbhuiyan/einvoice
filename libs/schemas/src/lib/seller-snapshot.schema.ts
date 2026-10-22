import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BIN_PATTERN, TAX_IDENTITY_CONSTRAINTS } from '@libs/shared/types';
import { EMBEDDED_SCHEMA_OPTIONS } from './base.schema';

@Schema(EMBEDDED_SCHEMA_OPTIONS)
export class SignatorySnapshot {
  @Prop({ required: true, trim: true, maxlength: TAX_IDENTITY_CONSTRAINTS.signatory.name.maxLength })
  name!: string;

  @Prop({ required: true, trim: true, maxlength: TAX_IDENTITY_CONSTRAINTS.signatory.designation.maxLength })
  designation!: string;
}

export const SignatorySnapshotSchema = SchemaFactory.createForClass(SignatorySnapshot);

/**
 * The issuing organization as it was when the invoice was issued: a tax invoice must keep saying
 * what it said, even after the organization moves, changes its signatory or its time zone. Drafts
 * have none (they render the organization's current details).
 */
@Schema(EMBEDDED_SCHEMA_OPTIONS)
export class SellerSnapshot {
  @Prop({ required: true, trim: true, maxlength: 160 })
  name!: string;

  /** Bangladesh BIN. With one, a BDT invoice is a Mushak-6.3 tax invoice. */
  @Prop({ type: String, default: undefined, match: [BIN_PATTERN, 'bin must be exactly 13 digits.'] })
  bin?: string;

  @Prop({ type: String, default: undefined, trim: true, maxlength: TAX_IDENTITY_CONSTRAINTS.address.maxLength })
  address?: string;

  @Prop({ type: SignatorySnapshotSchema, default: undefined })
  authorizedSignatory?: SignatorySnapshot;

  /** The zone the date and time of issue are printed in. */
  @Prop({ required: true })
  timeZone!: string;
}

export const SellerSnapshotSchema = SchemaFactory.createForClass(SellerSnapshot);
