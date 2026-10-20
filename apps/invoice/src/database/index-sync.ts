import type { Connection, Model, Schema } from 'mongoose';
import {
  AUDIT_LOG_MODEL_DEFINITION,
  CUSTOMER_MODEL_DEFINITION,
  INVOICE_COUNTER_MODEL_DEFINITION,
  INVOICE_MODEL_DEFINITION,
  OUTBOX_EVENT_MODEL_DEFINITION,
} from '@libs/schemas';

/** Every collection this service owns. A model added to the service belongs here too. */
export const OWNED_MODEL_DEFINITIONS: ReadonlyArray<{ name: string; schema: Schema }> = [
  INVOICE_MODEL_DEFINITION,
  CUSTOMER_MODEL_DEFINITION,
  INVOICE_COUNTER_MODEL_DEFINITION,
  AUDIT_LOG_MODEL_DEFINITION,
  OUTBOX_EVENT_MODEL_DEFINITION,
];

export interface IndexDrift {
  collection: string;
  /** Declared by the schema, missing from the database. */
  toCreate: unknown[];
  /** In the database, no longer declared by the schema (index names). */
  toDrop: string[];
}

function ownedModels(connection: Connection): Model<unknown>[] {
  return OWNED_MODEL_DEFINITIONS.map(
    ({ name, schema }) =>
      // Reuse a model the caller already registered on this connection (e.g. the app's own).
      (connection.models[name] ?? connection.model(name, schema)) as Model<unknown>,
  );
}

/**
 * How the database's indexes differ from the schemas'. Empty for every collection means no drift --
 * the Mongo equivalent of the TypeORM apps' `createSchemaBuilder().log()` check.
 */
export async function diffOwnedIndexes(connection: Connection): Promise<IndexDrift[]> {
  const drift: IndexDrift[] = [];
  for (const model of ownedModels(connection)) {
    // listIndexes fails on a collection that doesn't exist yet; creating it empty is harmless.
    await model.createCollection();
    const { toCreate, toDrop } = await model.diffIndexes();
    drift.push({ collection: model.collection.collectionName, toCreate, toDrop: toDrop as string[] });
  }
  return drift;
}

/**
 * Makes every owned collection's indexes exactly the schema's: builds missing ones and drops ones
 * the schema no longer declares (e.g. the pre-tenancy global `invoiceNumber_1` unique index, which
 * would reject the same number in two organizations).
 *
 * Production runs with autoIndex off -- an index build at boot on a large collection is not
 * something every replica should race to do -- so this is the deploy step that builds them.
 */
export async function syncOwnedIndexes(connection: Connection): Promise<void> {
  for (const model of ownedModels(connection)) {
    await model.createCollection();
    await model.syncIndexes();
  }
}
