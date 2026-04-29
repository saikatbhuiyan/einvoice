import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, isValidObjectId } from 'mongoose';
import { buildPaginationMeta } from '@libs/shared/types';
import { InvoiceModel, InvoiceModelName } from '@libs/schemas';
import {
  CreateInvoiceRequest,
  DeleteInvoiceResponse,
  FindAllInvoicesRequest,
  FindAllInvoicesResponse,
  InvoiceResponse,
  UpdateInvoiceRequest,
} from '@libs/interfaces/gateway';

@Injectable()
export class InvoiceService {
  constructor(@InjectModel(InvoiceModelName) private readonly invoiceModel: InvoiceModel) {}

  async create(createInvoiceDto: CreateInvoiceRequest): Promise<InvoiceResponse> {
    try {
      const createdInvoice = await this.invoiceModel.create(this.toPersistencePayload(createInvoiceDto));
      return this.toInvoiceResponse(createdInvoice);
    } catch (error) {
      this.handlePersistenceError(error);
    }
  }

  async findAll(query: FindAllInvoicesRequest): Promise<FindAllInvoicesResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const filter = this.buildFilter(query);

    const [items, total] = await Promise.all([
      this.invoiceModel.find(filter).sort({ issueDate: -1, createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.invoiceModel.countDocuments(filter).exec(),
    ]);

    return {
      items: items.map((invoice) => this.toInvoiceResponse(invoice)),
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findOne(id: string): Promise<InvoiceResponse> {
    const invoice = await this.invoiceModel.findById(this.ensureObjectId(id)).exec();

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    return this.toInvoiceResponse(invoice);
  }

  async update(id: string, updateInvoiceDto: UpdateInvoiceRequest): Promise<InvoiceResponse> {
    const invoice = await this.invoiceModel.findById(this.ensureObjectId(id)).exec();

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    invoice.set(this.toPersistencePayload(updateInvoiceDto));

    try {
      await invoice.save();
    } catch (error) {
      this.handlePersistenceError(error);
    }

    return this.toInvoiceResponse(invoice);
  }

  async remove(id: string): Promise<DeleteInvoiceResponse> {
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

  private toInvoiceResponse(invoice: { toJSON(): unknown }): InvoiceResponse {
    return invoice.toJSON() as InvoiceResponse;
  }

  private toPersistencePayload(payload: Partial<CreateInvoiceRequest | UpdateInvoiceRequest>) {
    return {
      ...payload,
      issueDate: payload.issueDate ? new Date(payload.issueDate) : payload.issueDate,
      dueDate: payload.dueDate ? new Date(payload.dueDate) : payload.dueDate,
    };
  }

  private buildFilter(query: FindAllInvoicesRequest): Record<string, unknown> {
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

  private handlePersistenceError(error: unknown): never {
    if (this.isDuplicateInvoiceNumberError(error)) {
      const invoiceNumber =
        typeof error.keyValue?.invoiceNumber === 'string' ? ` "${error.keyValue.invoiceNumber}"` : '';
      throw new ConflictException(`Invoice number${invoiceNumber} already exists.`);
    }

    if (error instanceof MongooseError.ValidationError) {
      throw new UnprocessableEntityException(this.formatValidationError(error));
    }

    throw error;
  }

  private isDuplicateInvoiceNumberError(
    error: unknown,
  ): error is { code: number; keyPattern?: Record<string, unknown>; keyValue?: Record<string, unknown> } {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const mongoError = error as { code?: unknown; keyPattern?: Record<string, unknown> };
    return mongoError.code === 11000 && Boolean(mongoError.keyPattern?.invoiceNumber);
  }

  private formatValidationError(error: MongooseError.ValidationError): string {
    const messages = Object.values(error.errors)
      .map((validationError) => validationError.message)
      .filter(Boolean);

    return messages.length > 0 ? messages.join(' ') : error.message;
  }
}
