import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BASE_SCHEMA_OPTIONS, BaseSchema } from './base.schema';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

@Schema({ ...BASE_SCHEMA_OPTIONS, collection: 'audit_logs' })
export class AuditLog extends BaseSchema {
  @Prop({ required: true, index: true })
  action!: AuditAction;

  @Prop({ required: true, index: true })
  entityType!: string;

  @Prop({ required: true, index: true })
  entityId!: string;

  @Prop()
  actor?: string;

  @Prop({ type: Object })
  diff?: Record<string, unknown>;

  @Prop({ type: Object })
  previous?: Record<string, unknown>;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export const AuditLogModelName = AuditLog.name;

export const AUDIT_LOG_MODEL_DEFINITION = {
  name: AuditLogModelName,
  schema: AuditLogSchema,
};
