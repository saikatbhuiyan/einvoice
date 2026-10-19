import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { Error as MongooseError, Types, isValidObjectId } from 'mongoose';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { InvoiceDocument, InvoiceModel } from '@libs/schemas';
import { CreateInvoiceRequest, FindAllInvoicesRequest, UpdateInvoiceRequest } from '@libs/interfaces/gateway';
import { EDITABLE_INVOICE_STATUSES, buildPaginationMeta, type InvoiceStatus } from '@libs/shared/types';
import { escapeRegExp } from '@libs/shared/utils';
import {
  IInvoiceRepository,
  INVOICE_READ_MODEL,
  INVOICE_WRITE_MODEL,
  PaginatedResult,
  StatusTransitionResult,
} from './invoice.repository.interface';

const CONTENT_FIELDS = ['invoiceNumber', 'client', 'items', 'currency', 'notes'] as const;

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

  async create(data: CreateInvoiceRequest): Promise<InvoiceDocument> {
    const idempotencyKey = data.idempotencyKey?.trim();

    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
    }

    try {
      return await this.writeModel.create({ ...this.toContentPayload(data), idempotencyKey });
    } catch (error) {
      // Concurrent retries with the same key can all pass the lookup above; a unique index lets
      // exactly one insert win. A retry carries the identical payload, so Mongo may report the
      // duplicate on invoiceNumber rather than idempotencyKey — whichever index it hits first.
      // Idempotency means the losers get the winner's invoice, not an error.
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

  async setPdfMetadata(id: string, pdfUrl: string, pdfGeneratedAt: Date): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;

    return this.writeModel
      .findOneAndUpdate(this.activeFilter(id), { pdfUrl, pdfGeneratedAt }, { returnDocument: 'after' })
      .exec();
  }

  async transitionStatus(
    id: string,
    from: readonly InvoiceStatus[],
    to: InvoiceStatus,
  ): Promise<StatusTransitionResult> {
    if (!isValidObjectId(id)) return { outcome: 'not_found' };

    // returnDocument 'before' is the only way to learn which of `from` the invoice was actually in
    // (for the audit diff) from the same atomic operation that changed it.
    const before = await this.writeModel
      .findOneAndUpdate(
        { ...this.activeFilter(id), status: { $in: from } },
        { $set: { status: to }, $inc: { version: 1 } },
        { returnDocument: 'before' },
      )
      .exec();

    if (!before) {
      const current = await this.writeModel.findOne(this.activeFilter(id)).exec();
      return current ? { outcome: 'rejected', invoice: current } : { outcome: 'not_found' };
    }

    const invoice = await this.writeModel.findOne(this.activeFilter(id)).exec();
    // Only a concurrent soft-delete could remove it in between, and only drafts can be deleted —
    // a transitioned invoice is never a draft. Treat it as gone rather than assert.
    if (!invoice) return { outcome: 'not_found' };

    return { outcome: 'transitioned', invoice, from: before.status };
  }

  /**
   * Base filter for every single-invoice query. Tenancy (organization scoping) is added here, once,
   * rather than at each call site.
   */
  private activeFilter(id: string): Record<string, unknown> {
    return { _id: id, deletedAt: null };
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
    return this.writeModel.findOne({ idempotencyKey, deletedAt: null }).exec();
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
    const filter: Record<string, unknown> = { deletedAt: null };

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
