import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Error as MongooseError, isValidObjectId } from 'mongoose';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { buildPaginationMeta } from '@libs/shared/types';
import {
  CreateInvoiceRequest,
  DeleteInvoiceResponse,
  FindAllInvoicesRequest,
  FindAllInvoicesResponse,
  InvoiceResponse,
  UpdateInvoiceRequest,
} from '@libs/interfaces/gateway';
import { INVOICE_REPOSITORY, IInvoiceRepository } from './invoice.repository.interface';

@Injectable()
export class InvoiceService {
  constructor(
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepository: IInvoiceRepository,
  ) {}

  async create(createInvoiceDto: CreateInvoiceRequest): Promise<InvoiceResponse> {
    try {
      const createdInvoice = await this.invoiceRepository.create(createInvoiceDto);
      return this.toInvoiceResponse(createdInvoice);
    } catch (error) {
      this.handlePersistenceError(error);
    }
  }

  async findAll(query: FindAllInvoicesRequest): Promise<FindAllInvoicesResponse> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const { items, total } = await this.invoiceRepository.findAll(query);

    return {
      items: items.map((invoice) => this.toInvoiceResponse(invoice)),
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findOne(id: string): Promise<InvoiceResponse> {
    const invoice = await this.invoiceRepository.findOne(this.ensureObjectId(id));

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    return this.toInvoiceResponse(invoice);
  }

  async update(id: string, updateInvoiceDto: UpdateInvoiceRequest): Promise<InvoiceResponse> {
    const invoice = await this.invoiceRepository.update(this.ensureObjectId(id), updateInvoiceDto);

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    return this.toInvoiceResponse(invoice);
  }

  async remove(id: string): Promise<DeleteInvoiceResponse> {
    const invoice = await this.invoiceRepository.remove(this.ensureObjectId(id));

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
