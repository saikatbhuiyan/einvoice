import { InvoiceDocument } from '@libs/schemas';
import { CreateInvoiceRequest, FindAllInvoicesRequest, UpdateInvoiceRequest } from '@libs/interfaces/gateway';

export const INVOICE_REPOSITORY = Symbol('INVOICE_REPOSITORY');

export const INVOICE_WRITE_MODEL = Symbol('INVOICE_WRITE_MODEL');
export const INVOICE_READ_MODEL = Symbol('INVOICE_READ_MODEL');

export interface OffsetPaginationResult {
  mode: 'offset';
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface CursorPaginationResult {
  mode: 'cursor';
  limit: number;
  hasNextPage: boolean;
  cursor?: string;
}

export type PaginatedResultMeta = OffsetPaginationResult | CursorPaginationResult;

export interface PaginatedResult<T = InvoiceDocument> {
  items: T[];
  meta: PaginatedResultMeta;
}

export interface IInvoiceRepository {
  create(data: CreateInvoiceRequest): Promise<InvoiceDocument>;

  findAll(query: FindAllInvoicesRequest): Promise<PaginatedResult>;

  findOne(id: string): Promise<InvoiceDocument | null>;

  update(id: string, data: UpdateInvoiceRequest): Promise<InvoiceDocument | null>;

  remove(id: string): Promise<InvoiceDocument | null>;
}
