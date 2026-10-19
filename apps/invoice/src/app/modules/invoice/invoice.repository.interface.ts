import { InvoiceDocument } from '@libs/schemas';
import { CreateInvoiceRequest, FindAllInvoicesRequest, UpdateInvoiceRequest } from '@libs/interfaces/gateway';
import type { ClientSession } from 'mongoose';
import type { InvoiceStatus } from '@libs/shared/types';

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

/**
 * Work that must commit or roll back together with a repository write -- in practice, enqueueing the
 * domain event that write produced into the transactional outbox. Runs inside the write's
 * transaction, after the write; throwing aborts both. May run more than once (transient transaction
 * errors are retried), so every write in it must go through `session`.
 */
export type InTransaction = (invoice: InvoiceDocument, session: ClientSession) => Promise<void>;

export interface IInvoiceRepository {
  /** `inTransaction` runs only when a new invoice is inserted, never for an idempotent replay. */
  create(data: CreateInvoiceRequest, inTransaction?: InTransaction): Promise<InvoiceDocument>;

  findAll(query: FindAllInvoicesRequest): Promise<PaginatedResult>;

  findOne(id: string): Promise<InvoiceDocument | null>;

  /** Only a draft can be edited: 409 for any other status, decided atomically with the write. */
  update(id: string, data: UpdateInvoiceRequest, version?: number): Promise<InvoiceDocument | null>;

  /** Only a draft can be deleted: 409 for any other status, decided atomically with the write. */
  remove(id: string, version?: number): Promise<InvoiceDocument | null>;

  /**
   * Records the S3 key of the latest rendered PDF. Deliberately bypasses the If-Match
   * optimistic-concurrency path update() uses: pdfKey/pdfGeneratedAt point at a rendering of the
   * content, not user-editable content, so a regeneration shouldn't need (or bump) the version a
   * concurrent content edit would race on.
   */
  setPdfMetadata(
    id: string,
    pdfKey: string,
    pdfGeneratedAt: Date,
    inTransaction?: InTransaction,
  ): Promise<InvoiceDocument | null>;

  /**
   * Atomically moves the invoice to `to`, only if its current status is one of `from` — the
   * single place any status change is written, so a concurrent change can never be overwritten.
   * Bumps `version` (unlike setPdfMetadata): a status change is a real change, and an in-flight
   * draft edit must fail its optimistic-concurrency check if the invoice was issued underneath it.
   */
  transitionStatus(
    id: string,
    from: readonly InvoiceStatus[],
    to: InvoiceStatus,
    inTransaction?: InTransaction,
  ): Promise<StatusTransitionResult>;
}

export type StatusTransitionResult =
  | { outcome: 'transitioned'; invoice: InvoiceDocument; from: InvoiceStatus }
  | { outcome: 'not_found' }
  /** The invoice exists but its status isn't one of `from`; `invoice` is its current state. */
  | { outcome: 'rejected'; invoice: InvoiceDocument };
