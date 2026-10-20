import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import { InvoiceCounterModelName, type InvoiceCounterModel } from '@libs/schemas';
import { requireOrganizationId } from '@libs/logging/correlation-context';
import { OrganizationSettingsService } from './organization-settings.service';

export function formatInvoiceNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Gapless, per-organization, per-year invoice numbers: `{prefix}-{year}-{000001…}`.
 *
 * The sequence is a counter document incremented *inside the transaction that issues the invoice*:
 * if that transaction aborts, the increment rolls back with it, so no number is ever skipped.
 * Concurrent issues in one organization conflict on the counter document; Mongoose retries the
 * losing transaction, which then takes the next number.
 */
@Injectable()
export class InvoiceNumberingService {
  constructor(
    @InjectModel(InvoiceCounterModelName) private readonly counters: InvoiceCounterModel,
    private readonly settings: OrganizationSettingsService,
  ) {}

  /**
   * Everything that must happen *before* the issuing transaction: the organization's prefix (a call
   * to user-access -- never made inside a transaction that may be retried), and the year's counter
   * document. Creating the counter here, idempotently, means the transaction only ever increments
   * an existing document: two first-of-the-year issues racing to *create* it inside their
   * transactions would fail with a duplicate key, which isn't a retryable transaction error.
   */
  async prepare(issuedAt: Date): Promise<{ organizationId: string; prefix: string; year: number }> {
    const organizationId = requireOrganizationId();
    const year = issuedAt.getUTCFullYear();
    const [{ invoicePrefix: prefix }] = await Promise.all([
      this.settings.current(),
      this.counters
        .updateOne({ _id: `${organizationId}:${year}` }, { $setOnInsert: { seq: 0 } }, { upsert: true })
        .exec(),
    ]);
    return { organizationId, prefix, year };
  }

  /** The next number, inside the issuing transaction. */
  async next(
    prepared: { organizationId: string; prefix: string; year: number },
    session: ClientSession,
  ): Promise<string> {
    const counter = await this.counters
      .findOneAndUpdate(
        { _id: `${prepared.organizationId}:${prepared.year}` },
        { $inc: { seq: 1 } },
        { returnDocument: 'after', session },
      )
      .exec();
    if (!counter) {
      throw new Error(`Invoice counter ${prepared.organizationId}:${prepared.year} vanished inside its transaction.`);
    }
    return formatInvoiceNumber(prepared.prefix, prepared.year, counter.seq);
  }
}
