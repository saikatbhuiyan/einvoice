import type { CursorPaginationMeta, InvoiceStatus, PaginationMeta, SupportedCurrency } from '@libs/shared/types';

export { INVOICE_CONSTRAINTS, INVOICE_STATUSES, SUPPORTED_CURRENCIES } from '@libs/shared/types';
export type { InvoiceStatus, SupportedCurrency } from '@libs/shared/types';

export interface ClientSnapshotRequest {
  name: string;
  email: string;
  address: string;
}

export interface InvoiceItemRequest {
  catalogId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
}

/**
 * Exactly one of `customerId` (the server snapshots that customer) or `client` (a one-off client).
 * No invoice number: the server assigns it when the invoice is issued.
 */
export interface CreateInvoiceRequest {
  customerId?: string;
  client?: ClientSnapshotRequest;
  reference?: string;
  items: InvoiceItemRequest[];
  currency: SupportedCurrency;
  issueDate?: string;
  dueDate?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface UpdateClientSnapshotRequest {
  name?: string;
  email?: string;
  address?: string;
}

export interface UpdateInvoiceItemRequest {
  catalogId?: string;
  name?: string;
  quantity?: number;
  unitPrice?: number;
  vatRate?: number;
}

export interface UpdateInvoiceRequest {
  reference?: string;
  client?: UpdateClientSnapshotRequest;
  items?: UpdateInvoiceItemRequest[];
  currency?: SupportedCurrency;
  issueDate?: string;
  dueDate?: string;
  notes?: string;
}

export const PAGINATION_MODES = ['offset', 'cursor'] as const;
export type PaginationMode = (typeof PAGINATION_MODES)[number];

export interface FindAllInvoicesRequest {
  page?: number;
  limit?: number;
  cursor?: string;
  /** `cursor` starts cursor pagination without a cursor (the first page). Omitted = offset mode. */
  pagination?: PaginationMode;
  status?: InvoiceStatus;
  currency?: SupportedCurrency;
  clientEmail?: string;
  customerId?: string;
  search?: string;
}

export interface InvoiceIdGatewayRequest {
  id: string;
}

export type FindOneInvoiceGatewayRequest = InvoiceIdGatewayRequest;

export interface DeleteInvoiceGatewayRequest extends InvoiceIdGatewayRequest {
  version?: number;
}

export interface UpdateInvoiceGatewayRequest extends InvoiceIdGatewayRequest {
  data: UpdateInvoiceRequest;
  version?: number;
}

export type ClientSnapshotResponse = ClientSnapshotRequest;

export interface InvoiceItemResponse extends InvoiceItemRequest {
  total: number;
}

export interface InvoiceResponse {
  id: string;
  organizationId: string;
  /** Absent on drafts: assigned when the invoice is issued. */
  invoiceNumber?: string;
  reference?: string;
  customerId?: string | null;
  client: ClientSnapshotResponse;
  items: InvoiceItemResponse[];
  currency: SupportedCurrency;
  status: InvoiceStatus;
  issueDate: string | Date;
  dueDate?: string | Date;
  notes?: string;
  subtotal: number;
  vatTotal: number;
  total: number;
  version: number;
  idempotencyKey?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface FindAllInvoicesResponse {
  items: InvoiceResponse[];
  meta: PaginationMeta;
}

export interface FindAllInvoicesCursorResponse {
  items: InvoiceResponse[];
  meta: Omit<CursorPaginationMeta, 'mode'>;
}

export type FindAllInvoicesResult = FindAllInvoicesResponse | FindAllInvoicesCursorResponse;

export interface DeleteInvoiceResponse {
  id: string;
  deleted: true;
}

/**
 * A short-lived link to an invoice's PDF. The bucket is private; ask for a new link
 * (GET /invoices/:id/pdf) rather than storing this one.
 */
export interface InvoicePdfDownload {
  url: string;
  /** ISO-8601 instant after which `url` stops working. */
  expiresAt: string;
  fileName: string;
}

export interface SendInvoiceResponse {
  /** The invoice as sent — issued, if it was still a draft. */
  invoice: InvoiceResponse;
  pdf: InvoicePdfDownload;
}
