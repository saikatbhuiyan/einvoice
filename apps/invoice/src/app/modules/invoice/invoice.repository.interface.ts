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

  update(id: string, data: UpdateInvoiceRequest, version?: number): Promise<InvoiceDocument | null>;

  remove(id: string, version?: number): Promise<InvoiceDocument | null>;

  /**
   * Deliberately bypasses the If-Match optimistic-concurrency path update() uses: pdfUrl/
   * pdfGeneratedAt are an informational cache, not user-editable business content, so a PDF
   * regeneration shouldn't need (or bump) the same version a concurrent content edit would race on.
   */
  setPdfMetadata(id: string, pdfUrl: string, pdfGeneratedAt: Date): Promise<InvoiceDocument | null>;

  /** Same rationale as setPdfMetadata: a webhook-driven status flip isn't a user edit racing on version. */
  markPaid(id: string): Promise<InvoiceDocument | null>;
}
