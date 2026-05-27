import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Types, isValidObjectId } from 'mongoose';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { InvoiceDocument, InvoiceModel } from '@libs/schemas';
import { CreateInvoiceRequest, FindAllInvoicesRequest, UpdateInvoiceRequest } from '@libs/interfaces/gateway';
import { buildPaginationMeta } from '@libs/shared/types';
import {
  IInvoiceRepository,
  INVOICE_READ_MODEL,
  INVOICE_WRITE_MODEL,
  PaginatedResult,
} from './invoice.repository.interface';

@Injectable()
export class InvoiceRepository implements IInvoiceRepository {
  constructor(
    @Inject(INVOICE_WRITE_MODEL) private readonly writeModel: InvoiceModel,
    @Inject(INVOICE_READ_MODEL) private readonly readModel: InvoiceModel,
  ) {}

  async create(data: CreateInvoiceRequest): Promise<InvoiceDocument> {
    if (data.idempotencyKey) {
      const existing = await this.writeModel
        .findOne({ idempotencyKey: data.idempotencyKey.trim(), deletedAt: null })
        .exec();
      if (existing) return existing;
    }

    return this.writeModel.create(this.toPersistencePayload(data));
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

  async update(id: string, data: UpdateInvoiceRequest): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;
    const invoice = await this.writeModel.findOne({ _id: id, deletedAt: null }).exec();
    if (!invoice) return null;

    invoice.set(this.toPersistencePayload(data));
    await invoice.save();
    return invoice;
  }

  async remove(id: string): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;
    return this.writeModel
      .findOneAndUpdate({ _id: id, deletedAt: null }, { deletedAt: new Date() }, { new: true })
      .exec();
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
      const search = query.search.trim();
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
    return {
      ...payload,
      issueDate: payload.issueDate ? new Date(payload.issueDate) : payload.issueDate,
      dueDate: payload.dueDate ? new Date(payload.dueDate) : payload.dueDate,
    };
  }
}
