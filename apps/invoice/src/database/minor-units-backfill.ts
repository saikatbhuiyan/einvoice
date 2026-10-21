import type { mongo } from 'mongoose';
import { MoneyError, computeLine, exponentOf, sumAmounts, toMinor, type Amounts } from '@libs/money';
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from '@libs/shared/types';

export interface MinorUnitsBackfillOptions {
  dryRun: boolean;
  /**
   * Also convert issued/paid/overdue/cancelled invoices whose recomputed amounts differ from the
   * stored ones, writing the recomputed amounts. Off by default: those invoices are legal records,
   * so a human decides (see `mismatches` in the report).
   */
  acceptRecomputed: boolean;
}

export interface AmountMismatch {
  id: string;
  status: string;
  currency: string;
  /** Minor units: as stored (the old floats, scaled) and as the engine computes them now. */
  stored: { netMinor: number; vatMinor: number; totalMinor: number };
  recomputed: { netMinor: number; vatMinor: number; totalMinor: number };
}

export interface MinorUnitsBackfillReport {
  /** Converted (or, in a dry run, would be). */
  invoicesConverted: number;
  /** Drafts whose amounts changed on recompute: converted anyway (a draft is not a record yet). */
  draftsRecomputed: AmountMismatch[];
  /** Non-drafts whose amounts would change: converted only with acceptRecomputed. */
  mismatches: AmountMismatch[];
  /** Documents that can't be expressed exactly (an unsupported currency, a price finer than it allows). */
  unconvertible: { id: string; reason: string }[];
}

interface LegacyItem {
  productId?: string;
  catalogId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
}

interface LegacyInvoice {
  _id: mongo.ObjectId;
  status: string;
  currency: string;
  items?: LegacyItem[];
  subtotal?: number;
  vatTotal?: number;
  total?: number;
}

/** Not converted yet: the new fields are what mark a document as migrated (so a re-run skips it). */
const LEGACY = { totalMinor: { $exists: false } };
const BATCH = 500;

/**
 * One-off and idempotent: rewrites every invoice stored with floating-point amounts (`unitPrice`,
 * line `total`, `subtotal`/`vatTotal`/`total`) into integer minor units (`unitPriceMinor`,
 * `netMinor`/`sdMinor`/`vatMinor`/`totalMinor`), recomputed by the same engine the schema uses,
 * with `sdRate: 0` (nothing had supplementary duty before).
 *
 * Every document whose recomputed amounts differ from the stored ones is reported. Drafts are
 * converted anyway; anything already issued is left unconverted unless `acceptRecomputed` -- the
 * caller must treat leftovers as a failed migration (the new version can't read them).
 *
 * Covers soft-deleted invoices too. Run with the invoice service stopped (old versions write the
 * old fields, the new one only reads the new ones).
 */
export async function backfillMinorUnits(
  db: mongo.Db,
  options: MinorUnitsBackfillOptions,
): Promise<MinorUnitsBackfillReport> {
  // Untyped: a document is read in the old shape and written in the new one.
  const invoices = db.collection('invoices');
  const report: MinorUnitsBackfillReport = {
    invoicesConverted: 0,
    draftsRecomputed: [],
    mismatches: [],
    unconvertible: [],
  };

  let batch: mongo.AnyBulkWriteOperation[] = [];
  const flush = async () => {
    if (!options.dryRun && batch.length > 0) await invoices.bulkWrite(batch, { ordered: false });
    batch = [];
  };

  for await (const document of invoices.find(LEGACY)) {
    const invoice = document as LegacyInvoice;
    const id = String(invoice._id);
    const converted = convert(invoice);
    if ('reason' in converted) {
      report.unconvertible.push({ id, reason: converted.reason });
      continue;
    }

    const stored = storedAmounts(invoice, invoice.currency as SupportedCurrency);
    const { totals } = converted;
    if (
      stored.netMinor !== totals.netMinor ||
      stored.vatMinor !== totals.vatMinor ||
      stored.totalMinor !== totals.totalMinor
    ) {
      const mismatch: AmountMismatch = {
        id,
        status: invoice.status,
        currency: invoice.currency,
        stored,
        recomputed: { netMinor: totals.netMinor, vatMinor: totals.vatMinor, totalMinor: totals.totalMinor },
      };
      if (invoice.status === 'draft') {
        report.draftsRecomputed.push(mismatch);
      } else {
        report.mismatches.push(mismatch);
        if (!options.acceptRecomputed) continue;
      }
    }

    batch.push({
      updateOne: {
        // Still legacy: never overwrite a document something else converted meanwhile.
        filter: { _id: invoice._id, ...LEGACY },
        update: {
          $set: { items: converted.items, ...totals },
          $unset: { subtotal: '', vatTotal: '', total: '' },
        },
      },
    });
    report.invoicesConverted += 1;
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  return report;
}

function convert(invoice: LegacyInvoice): { items: Record<string, unknown>[]; totals: Amounts } | { reason: string } {
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(invoice.currency)) {
    return { reason: `unsupported currency "${invoice.currency}"` };
  }
  const currency = invoice.currency as SupportedCurrency;

  try {
    const items = (invoice.items ?? []).map((item) => {
      const unitPriceMinor = toMinor(item.unitPrice, currency);
      const line = { quantity: item.quantity, unitPriceMinor, vatRate: item.vatRate, sdRate: 0 };
      return {
        ...(item.productId ? { productId: item.productId } : {}),
        catalogId: item.catalogId,
        name: item.name,
        ...line,
        ...computeLine(line),
      };
    });
    return { items, totals: sumAmounts(items) };
  } catch (error) {
    if (error instanceof MoneyError) return { reason: error.message };
    throw error;
  }
}

/** The old float totals in minor units (they were rounded to the currency's decimals when stored). */
function storedAmounts(invoice: LegacyInvoice, currency: SupportedCurrency) {
  const scale = 10 ** exponentOf(currency);
  const minor = (value: number | undefined) => Math.round((value ?? 0) * scale);
  return { netMinor: minor(invoice.subtotal), vatMinor: minor(invoice.vatTotal), totalMinor: minor(invoice.total) };
}
