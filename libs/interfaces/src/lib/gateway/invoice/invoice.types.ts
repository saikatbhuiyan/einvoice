import type {
  CursorPaginationMeta,
  InvoiceStatus,
  PaginationMeta,
  PaginationResultMeta,
  SupportedCurrency,
} from '@libs/shared/types';

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

export interface CreateInvoiceRequest {
  invoiceNumber: string;
  client: ClientSnapshotRequest;
  items: InvoiceItemRequest[];
  currency: SupportedCurrency;
  status?: InvoiceStatus;
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
  invoiceNumber?: string;
  client?: UpdateClientSnapshotRequest;
  items?: UpdateInvoiceItemRequest[];
  currency?: SupportedCurrency;
  status?: InvoiceStatus;
  issueDate?: string;
  dueDate?: string;
  notes?: string;
}

export interface FindAllInvoicesRequest {
  page?: number;
  limit?: number;
  cursor?: string;
  status?: InvoiceStatus;
  currency?: SupportedCurrency;
  clientEmail?: string;
  search?: string;
}

export interface InvoiceIdGatewayRequest {
  id: string;
}

export type FindOneInvoiceGatewayRequest = InvoiceIdGatewayRequest;

export type DeleteInvoiceGatewayRequest = InvoiceIdGatewayRequest;

export interface UpdateInvoiceGatewayRequest extends InvoiceIdGatewayRequest {
  data: UpdateInvoiceRequest;
}

export type ClientSnapshotResponse = ClientSnapshotRequest;

export interface InvoiceItemResponse extends InvoiceItemRequest {
  total: number;
}

export interface InvoiceResponse {
  id: string;
  invoiceNumber: string;
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
