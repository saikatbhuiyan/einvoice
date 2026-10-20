import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { Error as MongooseError, Types, isValidObjectId, type ClientSession } from 'mongoose';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { InvoiceDocument, InvoiceModel } from '@libs/schemas';
import { CreateInvoiceRequest, FindAllInvoicesRequest, UpdateInvoiceRequest } from '@libs/interfaces/gateway';
import { EDITABLE_INVOICE_STATUSES, buildPaginationMeta, type InvoiceStatus } from '@libs/shared/types';
import { escapeRegExp } from '@libs/shared/utils';
import { requireOrganizationId } from '@libs/logging/correlation-context';
import {
  IInvoiceRepository,
  INVOICE_READ_MODEL,
  INVOICE_WRITE_MODEL,
  InTransaction,
  InvoiceRef,
  NewInvoice,
  PaginatedResult,
  StatusTransitionResult,
  TransitionOptions,
} from './invoice.repository.interface';

// invoiceNumber is not content: the server assigns it on issue (transitionStatus' prepare hook).
const CONTENT_FIELDS = ['reference', 'client', 'items', 'currency', 'notes'] as const;

const CONCURRENT_MODIFICATION_MESSAGE = 'Invoice was modified by another user. Please refresh and retry.';

function isDuplicateKey(error: unknown, field?: string): boolean {
  const mongoError = error as { code?: unknown; keyPattern?: Record<string, unknown> } | null;
  return mongoError?.code === 11000 && (field === undefined || Boolean(mongoError.keyPattern?.[field]));
}

@Injectable()
export class InvoiceRepository implements IInvoiceRepository {
  constructor(
    @Inject(INVOICE_WRITE_MODEL) private readonly writeModel: InvoiceModel,
    @Inject(INVOICE_READ_MODEL) private readonly readModel: InvoiceModel,
  ) {}

  async create(data: NewInvoice, inTransaction?: InTransaction): Promise<InvoiceDocument> {
    const idempotencyKey = data.idempotencyKey?.trim();

    if (idempotencyKey) {
      // An idempotent replay returns the original invoice and runs no hook: its events were
      // written when it was first created.
      const existing = await this.findByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
    }

    try {
      return await this.transaction(async (session) => {
        const [invoice] = await this.writeModel.create(
          [
            {
              ...this.toContentPayload(data),
              organizationId: requireOrganizationId(),
              customerId: data.customerId ?? null,
              idempotencyKey,
            },
          ],
          { session },
        );
        await inTransaction?.(invoice, session);
        return invoice;
      });
    } catch (error) {
      // Concurrent retries with the same key can all pass the lookup above; the (organization,
      // idempotencyKey) unique index lets exactly one insert win. Idempotency means the losers get
      // the winner's invoice, not an error.
      if (idempotencyKey && isDuplicateKey(error)) {
        const winner = await this.findByIdempotencyKey(idempotencyKey);
        if (winner) return winner;
        if (isDuplicateKey(error, 'idempotencyKey')) {
          throw new ConflictException(
            'This idempotency key was already used for an invoice that has since been deleted.',
          );
        }
      }
      throw error;
    }
  }

  async findAll(query: FindAllInvoicesRequest): Promise<PaginatedResult<InvoiceDocument>> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const filter = this.buildFilter(query);

    if (query.cursor || query.pagination === 'cursor') {
      return this.findAllWithCursor(query.cursor, limit, filter);
    }

    return this.findAllWithOffset(query, limit, filter);
  }

  async findOne(id: string): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;
    return this.readModel.findOne(this.activeFilter(id)).exec();
  }

  async update(id: string, data: UpdateInvoiceRequest, version?: number): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;

    const invoice = await this.writeModel.findOne(this.editableFilter(id, version)).exec();
    if (!invoice) {
      return this.explainEditMiss(id, version, 'edited');
    }

    invoice.set(this.toContentPayload(data));
    try {
      await invoice.save();
    } catch (error) {
      // Another writer saved (or changed the status) between our read and this save;
      // optimisticConcurrency makes Mongoose reject it. Same outcome as a stale If-Match, so the same 409.
      if (error instanceof MongooseError.VersionError) {
        throw new ConflictException(CONCURRENT_MODIFICATION_MESSAGE);
      }
      throw error;
    }
    return invoice;
  }

  async remove(id: string, version?: number): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;

    const result = await this.writeModel
      .findOneAndUpdate(this.editableFilter(id, version), { deletedAt: new Date() }, { returnDocument: 'after' })
      .exec();

    return result ?? this.explainEditMiss(id, version, 'deleted');
  }

  async setPdfMetadata(
    id: string,
    pdfKey: string,
    pdfGeneratedAt: Date,
    inTransaction?: InTransaction,
  ): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;

    return this.transaction(async (session) => {
      const invoice = await this.writeModel
        .findOneAndUpdate(
          this.activeFilter(id),
          { $set: { pdfKey, pdfGeneratedAt } },
          { returnDocument: 'after', session },
        )
        .exec();
      if (invoice) await inTransaction?.(invoice, session);
      return invoice;
    });
  }

  async transitionStatus(
    id: string,
    from: readonly InvoiceStatus[],
    to: InvoiceStatus,
    options: TransitionOptions = {},
  ): Promise<StatusTransitionResult> {
    if (!isValidObjectId(id)) return { outcome: 'not_found' };

    return this.transaction(async (session): Promise<StatusTransitionResult> => {
      // Read first, inside the transaction: a wrong status must be known *before* `prepare` runs,
      // or issuing a non-draft would still consume an invoice number.
      const current = await this.writeModel.findOne(this.activeFilter(id)).session(session).exec();
      if (!current) return { outcome: 'not_found' };
      if (!from.includes(current.status)) return { outcome: 'rejected', invoice: current };

      const extra = options.prepare ? await options.prepare(current, session) : {};

      // Guarded on the version just read: within the transaction a concurrent writer surfaces as a
      // write conflict (retried by Mongoose), so this matching nothing would be a real anomaly.
      const invoice = await this.writeModel
        .findOneAndUpdate(
          { ...this.activeFilter(id), status: current.status, version: current.version },
          { $set: { ...extra, status: to }, $inc: { version: 1 } },
          { returnDocument: 'after', session },
        )
        .exec();
      if (!invoice) throw new ConflictException(CONCURRENT_MODIFICATION_MESSAGE);

      await options.inTransaction?.(invoice, session);
      return { outcome: 'transitioned', invoice, from: current.status };
    });
  }

  async findPastDueIssued(before: Date, limit: number): Promise<InvoiceRef[]> {
    // Unscoped by design (system work across tenants); matches the partial { status, dueDate } index.
    const rows = await this.writeModel
      .find({ status: 'issued', dueDate: { $lt: before }, deletedAt: null })
      .sort({ dueDate: 1 })
      .limit(limit)
      .select({ _id: 1, organizationId: 1 })
      .lean()
      .exec();
    return rows.map((row) => ({ id: String(row._id), organizationId: row.organizationId }));
  }

  async findDueReminders(now: Date, limit: number): Promise<InvoiceRef[]> {
    // Unscoped by design; matches the partial { status, nextReminderAt } index.
    const rows = await this.writeModel
      .find({ status: 'overdue', nextReminderAt: { $type: 'date', $lte: now }, deletedAt: null })
      .sort({ nextReminderAt: 1 })
      .limit(limit)
      .select({ _id: 1, organizationId: 1 })
      .lean()
      .exec();
    return rows.map((row) => ({ id: String(row._id), organizationId: row.organizationId }));
  }

  async advanceReminder(
    id: string,
    scheduledAt: Date,
    next: Date | null,
    sent: { at: Date; inTransaction?: InTransaction } | null,
  ): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;

    return this.transaction(async (session) => {
      // No version bump: a reminder changes no content, and overdue invoices aren't editable anyway.
      const update = sent
        ? { $inc: { remindersSent: 1 }, $set: { lastReminderAt: sent.at, nextReminderAt: next } }
        : { $set: { nextReminderAt: next } };
      const invoice = await this.writeModel
        .findOneAndUpdate({ ...this.activeFilter(id), status: 'overdue', nextReminderAt: scheduledAt }, update, {
          returnDocument: 'after',
          session,
        })
        .exec();
      if (invoice && sent) await sent.inTransaction?.(invoice, session);
      return invoice;
    });
  }

  /**
   * Runs `work` in a MongoDB transaction (requires a replica set). Mongoose retries the whole callback
   * on transient transaction errors, so `work` must be safe to re-run -- every write in it goes
   * through `session` and is discarded on abort.
   */
  private transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    return this.writeModel.db.transaction(work);
  }

  /**
   * Base filter for every single-invoice query. Tenancy (organization scoping) is added here, once,
   * rather than at each call site.
   */
  private activeFilter(id: string): Record<string, unknown> {
    return { _id: id, organizationId: requireOrganizationId(), deletedAt: null };
  }

  private editableFilter(id: string, version?: number): Record<string, unknown> {
    return {
      ...this.activeFilter(id),
      status: { $in: EDITABLE_INVOICE_STATUSES },
      ...(version !== undefined && { version }),
    };
  }

  /**
   * The editable filter matched nothing: work out which of its conditions failed so the caller
   * gets the right answer — 404 (gone), 409 stale version, or 409 wrong status.
   */
  private async explainEditMiss(id: string, version: number | undefined, verb: 'edited' | 'deleted'): Promise<null> {
    const current = await this.writeModel.findOne(this.activeFilter(id)).select({ status: 1, version: 1 }).exec();
    if (!current) return null;

    if (version !== undefined && current.version !== version) {
      throw new ConflictException(CONCURRENT_MODIFICATION_MESSAGE);
    }

    if (!EDITABLE_INVOICE_STATUSES.includes(current.status)) {
      throw new ConflictException(
        `Invoice is ${current.status}; only draft invoices can be ${verb}. Issued invoices are immutable.`,
      );
    }

    // Matched every condition on re-read, so it changed between the two queries.
    throw new ConflictException(CONCURRENT_MODIFICATION_MESSAGE);
  }

  private findByIdempotencyKey(idempotencyKey: string): Promise<InvoiceDocument | null> {
    return this.writeModel.findOne({ organizationId: requireOrganizationId(), idempotencyKey, deletedAt: null }).exec();
  }

  // No cursor = the first cursor page (`pagination=cursor`); otherwise everything older than it.
  private async findAllWithCursor(
    cursor: string | undefined,
    limit: number,
    filter: Record<string, unknown>,
  ): Promise<PaginatedResult<InvoiceDocument>> {
    const cursorFilter = cursor ? { ...filter, _id: { $lt: new Types.ObjectId(this.decodeCursor(cursor)) } } : filter;

    const items = await this.readModel
      .find(cursorFilter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasNextPage = items.length > limit;
    const trimmed = hasNextPage ? items.slice(0, limit) : items;
    const nextCursor = hasNextPage ? this.encodeCursor(trimmed[trimmed.length - 1]._id.toString()) : undefined;

    return {
      items: trimmed,
      meta: { mode: 'cursor', limit, hasNextPage, cursor: nextCursor },
    };
  }

  private async findAllWithOffset(
    query: FindAllInvoicesRequest,
    limit: number,
    filter: Record<string, unknown>,
  ): Promise<PaginatedResult<InvoiceDocument>> {
    const page = query.page ?? DEFAULT_PAGE;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.readModel.find(filter).sort({ issueDate: -1, createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.readModel.countDocuments(filter).exec(),
    ]);

    return {
      items,
      meta: { mode: 'offset', ...buildPaginationMeta(page, limit, total) },
    };
  }

  private encodeCursor(id: string): string {
    return Buffer.from(id).toString('base64url');
  }

  private decodeCursor(cursor: string): string {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');

    if (!/^[0-9a-fA-F]{24}$/.test(decoded) || !isValidObjectId(decoded)) {
      throw new BadRequestException('Invalid cursor.');
    }

    return decoded;
  }

  private buildFilter(query: FindAllInvoicesRequest): Record<string, unknown> {
    const filter: Record<string, unknown> = { organizationId: requireOrganizationId(), deletedAt: null };

    if (query.customerId) {
      filter.customerId = query.customerId;
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.currency) {
      filter.currency = query.currency;
    }

    if (query.clientEmail) {
      filter['client.email'] = query.clientEmail.toLowerCase();
    }

    if (query.search) {
      // User input: escaped so "." or "(" match literally and can't form an invalid or
      // catastrophically backtracking pattern on the database.
      const search = escapeRegExp(query.search.trim());
      if (search) {
        filter.$or = [
          { invoiceNumber: { $regex: search, $options: 'i' } },
          { reference: { $regex: search, $options: 'i' } },
          { 'client.name': { $regex: search, $options: 'i' } },
          { 'client.email': { $regex: search, $options: 'i' } },
        ];
      }
    }

    return filter;
  }

  /**
   * Allow-lists the user-editable content fields. RPC payloads reach this service without DTO
   * validation (a `RpcEnvelope<Dto> | Dto` parameter reflects as Object, so the ValidationPipe
   * skips it), so this is the boundary that keeps `status`, `deletedAt`, `pdfUrl`, `version` etc.
   * out of a create/update — status only ever changes through transitionStatus.
   */
  private toContentPayload(payload: Partial<CreateInvoiceRequest | UpdateInvoiceRequest>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const field of CONTENT_FIELDS) {
      // Only touch keys actually provided: assigning `undefined` would make a partial update's
      // `.set()` call clear existing values on the document.
      if (payload[field] !== undefined) {
        result[field] = payload[field];
      }
    }

    if (payload.issueDate) {
      result.issueDate = new Date(payload.issueDate);
    }

    if (payload.dueDate) {
      result.dueDate = new Date(payload.dueDate);
    }

    return result;
  }
}
