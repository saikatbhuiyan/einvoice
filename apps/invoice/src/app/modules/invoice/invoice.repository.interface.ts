import { InvoiceDocument } from '@libs/schemas';
import {
  ClientSnapshotRequest,
  CreateInvoiceRequest,
  FindAllInvoicesRequest,
  UpdateInvoiceRequest,
} from '@libs/interfaces/gateway';
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

/** A create request whose client snapshot has been resolved (inline, or copied from a customer). */
export type NewInvoice = Omit<CreateInvoiceRequest, 'client' | 'customerId'> & {
  client: ClientSnapshotRequest;
  customerId?: string;
};

export interface TransitionOptions {
  /**
   * Runs inside the transaction, after the status check passed and before the update: returns
   * extra fields to set atomically with the new status (issuing: the invoice number and issue date).
   * Throwing aborts the transition -- including any counter it incremented.
   */
  prepare?: (current: InvoiceDocument, session: ClientSession) => Promise<Record<string, unknown>>;
  /** Runs inside the transaction after the update (e.g. enqueueing the event it produced). */
  inTransaction?: InTransaction;
}

export interface IInvoiceRepository {
  /**
   * Inserts a draft in the current organization. `inTransaction` runs only when a new invoice is
   * inserted, never for an idempotent replay.
   */
  create(data: NewInvoice, inTransaction?: InTransaction): Promise<InvoiceDocument>;

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
    options?: TransitionOptions,
  ): Promise<StatusTransitionResult>;

  /**
   * System scan (the overdue scheduler): issued invoices whose due date is before `before`, across
   * **all organizations** -- deliberately unscoped, like the Stripe webhook's session lookup. Returns
   * only ids and organizations; each is then handled inside its own organization (runAsSystem).
   */
  findPastDueIssued(before: Date, limit: number): Promise<InvoiceRef[]>;

  /** System scan: overdue invoices whose next reminder is due by `now`, across all organizations. */
  findDueReminders(now: Date, limit: number): Promise<InvoiceRef[]>;

  /**
   * Handles the reminder scheduled for `scheduledAt` -- sent (`sent` given: counts it, runs
   * `sent.inTransaction` in the same transaction, e.g. the outbox event) or skipped (`sent` null) --
   * and schedules `next`. Conditional on `nextReminderAt` still being `scheduledAt` and the invoice
   * still overdue, so a reminder can only ever be handled once; returns null if it already was (or
   * the invoice was paid or cancelled meanwhile).
   */
  advanceReminder(
    id: string,
    scheduledAt: Date,
    next: Date | null,
    sent: { at: Date; inTransaction?: InTransaction } | null,
  ): Promise<InvoiceDocument | null>;
}

/** An invoice found by a system scan: enough to act on it inside its own organization. */
export interface InvoiceRef {
  id: string;
  organizationId: string;
}

export type StatusTransitionResult =
  | { outcome: 'transitioned'; invoice: InvoiceDocument; from: InvoiceStatus }
  | { outcome: 'not_found' }
  /** The invoice exists but its status isn't one of `from`; `invoice` is its current state. */
  | { outcome: 'rejected'; invoice: InvoiceDocument };
