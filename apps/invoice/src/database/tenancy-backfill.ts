import type { mongo } from 'mongoose';
import { escapeRegExp } from '@libs/shared/utils';
import { DEFAULT_ORGANIZATION_ID } from '@libs/shared/types';

export interface TenancyBackfillOptions {
  dryRun: boolean;
  /**
   * The default organization's invoice prefix (user-access's migration creates it with `INV`).
   * Only existing numbers in exactly the format the numbering service will produce with it can
   * collide with a future number, so only those move its counters.
   */
  prefix: string;
}

export interface TenancyBackfillReport {
  /** The pre-tenancy global unique indexes, dropped first (sync-indexes builds per-org ones). */
  legacyIndexesDropped: string[];
  invoicesAssigned: number;
  /** Legacy drafts whose client-chosen number became their `reference` (drafts are now unnumbered). */
  draftNumbersMovedToReference: number;
  /** Legacy drafts that already had a reference: their old number is dropped, listed for a human. */
  draftNumbersDropped: string[];
  auditEntriesAssigned: number;
  /** `<organizationId>:<year>` -> the sequence its counter must be at least. */
  counters: Record<string, number>;
}

const LEGACY = { organizationId: { $exists: false } };

/**
 * Unique across *all* invoices, so they would reject the same number in two organizations. And
 * invoiceNumber_1 is not sparse: it counts a missing number as null, so it would also reject
 * un-numbering more than one legacy draft -- which is why they go before anything else.
 */
const LEGACY_GLOBAL_UNIQUE_INDEXES = ['invoiceNumber_1', 'idempotencyKey_1'];

/**
 * One-off and idempotent: moves pre-tenancy invoice data into the default organization, the same
 * one user-access's AddOrganizationsAndMemberships migration moves every existing user into.
 *
 * Run with the invoice service stopped (it is the step between the old version and the new):
 * the old version writes invoices with no organization, the new one can't read them. Follow it
 * with sync-indexes, which builds the per-organization unique indexes this leaves missing.
 */
export async function backfillTenancy(db: mongo.Db, options: TenancyBackfillOptions): Promise<TenancyBackfillReport> {
  const invoices = db.collection('invoices');
  const legacyDraftsWithNumber = { ...LEGACY, status: 'draft', invoiceNumber: { $type: 'string' } };

  const draftNumbersDropped = (
    await invoices
      .find({ ...legacyDraftsWithNumber, reference: { $type: 'string' } }, { projection: { _id: 1 } })
      .toArray()
  ).map((doc) => String(doc._id));
  const draftsToMove = await invoices.countDocuments({
    ...legacyDraftsWithNumber,
    reference: { $not: { $type: 'string' } },
  });
  const invoicesToAssign = await invoices.countDocuments(LEGACY);
  const auditEntriesToAssign = await db.collection('audit_logs').countDocuments({ ...LEGACY, entityType: 'invoice' });
  const counters = await counterFloors(invoices, options.prefix);
  const existingIndexes = await invoices.indexes().catch((error: { codeName?: string }) => {
    if (error.codeName === 'NamespaceNotFound') return [];
    throw error;
  });
  const legacyIndexesDropped = existingIndexes
    .map((index) => index.name as string)
    .filter((name) => LEGACY_GLOBAL_UNIQUE_INDEXES.includes(name));

  if (!options.dryRun) {
    for (const name of legacyIndexesDropped) {
      await invoices.dropIndex(name);
    }
    // Drafts first: "no organizationId" is what marks a document as not yet migrated.
    await invoices.updateMany(legacyDraftsWithNumber, [
      { $set: { reference: { $ifNull: ['$reference', '$invoiceNumber'] } } },
      { $unset: 'invoiceNumber' },
    ]);
    await invoices.updateMany(LEGACY, { $set: { organizationId: DEFAULT_ORGANIZATION_ID } });
    // Only invoice entries: an audit entry with no organization is otherwise a platform action.
    await db
      .collection('audit_logs')
      .updateMany({ ...LEGACY, entityType: 'invoice' }, { $set: { organizationId: DEFAULT_ORGANIZATION_ID } });
    for (const [id, seq] of Object.entries(counters)) {
      // $max: never moves a counter backwards (a re-run, or numbers issued since).
      await db
        .collection<{ _id: string; seq: number }>('invoice_counters')
        .updateOne({ _id: id }, { $max: { seq } }, { upsert: true });
    }
  }

  return {
    legacyIndexesDropped,
    invoicesAssigned: invoicesToAssign,
    draftNumbersMovedToReference: draftsToMove,
    draftNumbersDropped,
    auditEntriesAssigned: auditEntriesToAssign,
    counters,
  };
}

/**
 * Per year, the highest existing `{prefix}-{year}-{NNNNNN+}` number in the default organization
 * (legacy documents count: they are about to join it). Non-drafts only -- legacy drafts lose their
 * number above.
 */
async function counterFloors(invoices: mongo.Collection, prefix: string): Promise<Record<string, number>> {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d{4})-(\\d{6,})$`);
  const numbered = invoices.find(
    {
      $or: [{ organizationId: DEFAULT_ORGANIZATION_ID }, LEGACY],
      status: { $ne: 'draft' },
      invoiceNumber: { $regex: pattern },
    },
    { projection: { invoiceNumber: 1 } },
  );

  const floors: Record<string, number> = {};
  for await (const doc of numbered) {
    const [, year, seq] = pattern.exec(String(doc['invoiceNumber'])) as RegExpExecArray;
    const id = `${DEFAULT_ORGANIZATION_ID}:${year}`;
    floors[id] = Math.max(floors[id] ?? 0, Number(seq));
  }
  return floors;
}
