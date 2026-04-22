import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId } from 'mongoose';
import { buildPaginationMeta } from '@libs/shared/types';
import { Invoice, InvoiceDocument, InvoiceModel, InvoiceModelName } from '@libs/schemas';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { FindAllInvoicesDto } from './dto/find-all-invoices.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class InvoiceService {
  constructor(@InjectModel(InvoiceModelName) private readonly invoiceModel: InvoiceModel) {}

  async create(createInvoiceDto: CreateInvoiceDto) {
    const createdInvoice = await this.invoiceModel.create(this.toPersistencePayload(createInvoiceDto));
    return createdInvoice.toJSON();
  }

  async findAll(query: FindAllInvoicesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const filter = this.buildFilter(query);

    const [items, total] = await Promise.all([
      this.invoiceModel.find(filter).sort({ issueDate: -1, createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.invoiceModel.countDocuments(filter).exec(),
    ]);

    return {
      items: items.map((invoice) => invoice.toJSON()),
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const invoice = await this.invoiceModel.findById(this.ensureObjectId(id)).exec();

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    return invoice.toJSON();
  }

  async update(id: string, updateInvoiceDto: UpdateInvoiceDto) {
    const invoice = await this.invoiceModel.findById(this.ensureObjectId(id)).exec();

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    invoice.set(this.toPersistencePayload(updateInvoiceDto));
    await invoice.save();

    return invoice.toJSON();
  }

  async remove(id: string) {
    const invoice = await this.invoiceModel.findByIdAndDelete(this.ensureObjectId(id)).exec();

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    return {
      id,
      deleted: true,
    };
  }

  private ensureObjectId(id: string): string {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`"${id}" is not a valid invoice id.`);
    }

    return id;
  }

  private toPersistencePayload(payload: Partial<CreateInvoiceDto | UpdateInvoiceDto>) {
    return {
      ...payload,
      issueDate: payload.issueDate ? new Date(payload.issueDate) : payload.issueDate,
      dueDate: payload.dueDate ? new Date(payload.dueDate) : payload.dueDate,
    };
  }

  private buildFilter(query: FindAllInvoicesDto): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

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
}
