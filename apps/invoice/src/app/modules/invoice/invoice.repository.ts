import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { Error as MongooseError, Types, isValidObjectId } from 'mongoose';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { InvoiceDocument, InvoiceModel } from '@libs/schemas';
import { CreateInvoiceRequest, FindAllInvoicesRequest, UpdateInvoiceRequest } from '@libs/interfaces/gateway';
import { buildPaginationMeta } from '@libs/shared/types';
import { escapeRegExp } from '@libs/shared/utils';
import {
  IInvoiceRepository,
  INVOICE_READ_MODEL,
  INVOICE_WRITE_MODEL,
  PaginatedResult,
} from './invoice.repository.interface';

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
      return await this.writeModel.create(this.toPersistencePayload(data));
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

    if (query.cursor) {
      return this.findAllWithCursor(query.cursor, limit, filter);
    }

    return this.findAllWithOffset(query, limit, filter);
  }

  async findOne(id: string): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;
    return this.readModel.findOne({ _id: id, deletedAt: null }).exec();
  }

  async update(id: string, data: UpdateInvoiceRequest, version?: number): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;

    const filter: Record<string, unknown> = { _id: id, deletedAt: null };
    if (version !== undefined) {
      filter.version = version;
    }

    const invoice = await this.writeModel.findOne(filter as Record<string, unknown>).exec();
    if (!invoice) {
      if (version !== undefined) {
        const exists = await this.writeModel.exists({ _id: id, deletedAt: null });
        if (exists) {
          throw new ConflictException(CONCURRENT_MODIFICATION_MESSAGE);
        }
      }
      return null;
    }

    invoice.set(this.toPersistencePayload(data));
    try {
      await invoice.save();
    } catch (error) {
      // Another writer saved between our versioned read and this save; optimisticConcurrency makes
      // Mongoose reject it. Same outcome as a stale If-Match, so the same 409.
      if (error instanceof MongooseError.VersionError) {
        throw new ConflictException(CONCURRENT_MODIFICATION_MESSAGE);
      }
      throw error;
    }
    return invoice;
  }

  async remove(id: string, version?: number): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;

    const filter: Record<string, unknown> = { _id: id, deletedAt: null };
    if (version !== undefined) {
      filter.version = version;
    }

    const result = await this.writeModel
      .findOneAndUpdate(filter as Record<string, unknown>, { deletedAt: new Date() }, { new: true })
      .exec();

    if (!result && version !== undefined) {
      const exists = await this.writeModel.exists({ _id: id, deletedAt: null });
      if (exists) {
        throw new ConflictException(CONCURRENT_MODIFICATION_MESSAGE);
      }
    }

    return result;
  }

  async setPdfMetadata(id: string, pdfUrl: string, pdfGeneratedAt: Date): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;

    return this.writeModel
      .findOneAndUpdate({ _id: id, deletedAt: null }, { pdfUrl, pdfGeneratedAt }, { new: true })
      .exec();
  }

  async markPaid(id: string): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;

    return this.writeModel.findOneAndUpdate({ _id: id, deletedAt: null }, { status: 'paid' }, { new: true }).exec();
  }

  private findByIdempotencyKey(idempotencyKey: string): Promise<InvoiceDocument | null> {
    return this.writeModel.findOne({ idempotencyKey, deletedAt: null }).exec();
  }

  private async findAllWithCursor(
    cursor: string,
    limit: number,
    filter: Record<string, unknown>,
  ): Promise<PaginatedResult<InvoiceDocument>> {
    const decodedId = this.decodeCursor(cursor);

    const cursorFilter = {
      ...filter,
      _id: { $lt: new Types.ObjectId(decodedId) },
    };

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

  private toPersistencePayload(payload: Partial<CreateInvoiceRequest | UpdateInvoiceRequest>) {
    const result: Record<string, unknown> = { ...payload };

    // Only touch these keys when actually provided: unconditionally assigning them (even to
    // `undefined`) would make a partial update's `.set()` call clear existing values on the document.
    if (payload.issueDate) {
      result.issueDate = new Date(payload.issueDate);
    }

    if (payload.dueDate) {
      result.dueDate = new Date(payload.dueDate);
    }

    return result;
  }
}
