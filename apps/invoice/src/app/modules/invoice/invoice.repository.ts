import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId } from 'mongoose';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { InvoiceDocument, InvoiceModel, InvoiceModelName } from '@libs/schemas';
import { CreateInvoiceRequest, FindAllInvoicesRequest, UpdateInvoiceRequest } from '@libs/interfaces/gateway';
import { IInvoiceRepository } from './invoice.repository.interface';

@Injectable()
export class InvoiceRepository implements IInvoiceRepository {
  constructor(@InjectModel(InvoiceModelName) private readonly invoiceModel: InvoiceModel) {}

  async create(data: CreateInvoiceRequest): Promise<InvoiceDocument> {
    return this.invoiceModel.create(this.toPersistencePayload(data));
  }

  async findAll(query: FindAllInvoicesRequest): Promise<{
    items: InvoiceDocument[];
    total: number;
  }> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const skip = (page - 1) * limit;
    const filter = this.buildFilter(query);

    const [items, total] = await Promise.all([
      this.invoiceModel.find(filter).sort({ issueDate: -1, createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.invoiceModel.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }

  async findOne(id: string): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;
    return this.invoiceModel.findOne({ _id: id, deletedAt: null }).exec();
  }

  async update(id: string, data: UpdateInvoiceRequest): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;
    const invoice = await this.invoiceModel.findOne({ _id: id, deletedAt: null }).exec();
    if (!invoice) return null;

    invoice.set(this.toPersistencePayload(data));
    await invoice.save();
    return invoice;
  }

  async remove(id: string): Promise<InvoiceDocument | null> {
    if (!isValidObjectId(id)) return null;
    return this.invoiceModel
      .findOneAndUpdate({ _id: id, deletedAt: null }, { deletedAt: new Date() }, { new: true })
      .exec();
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
