import { Schema } from '@nestjs/mongoose';
import { HydratedDocument, SchemaOptions, Types } from 'mongoose';

type SerializedDocument = {
  _id?: unknown;
  id?: string;
  __v?: number;
  [key: string]: unknown;
};

const serializeDocument = (_: unknown, ret: SerializedDocument): SerializedDocument => {
  if (ret._id != null) {
    ret.id = String(ret._id);
    delete ret._id;
  }

  return ret;
};

export const BASE_SCHEMA_OPTIONS: SchemaOptions = {
  timestamps: true,
  versionKey: false,
  toJSON: {
    virtuals: true,
    transform: serializeDocument,
  },
  toObject: {
    virtuals: true,
    transform: serializeDocument,
  },
};

export const EMBEDDED_SCHEMA_OPTIONS: SchemaOptions = {
  _id: false,
  id: false,
  versionKey: false,
};

@Schema(BASE_SCHEMA_OPTIONS)
export abstract class BaseSchema {
  _id!: Types.ObjectId;

  // Managed by Mongoose timestamps
  createdAt!: Date;
  updatedAt!: Date;
}

export type BaseDocument<T extends BaseSchema> = HydratedDocument<T>;
