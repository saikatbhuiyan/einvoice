import type { PaginationMeta } from '@libs/shared/types';

export interface CreateCustomerRequest {
  name: string;
  email: string;
  address: string;
  taxId?: string;
  /** Bangladesh BIN of a registered buyer (13 digits), printed on its Mushak-6.3 tax invoices. */
  bin?: string;
  notes?: string;
}

/** `bin: null` removes it. Invoices already issued keep the BIN they were issued with. */
export type UpdateCustomerRequest = Partial<Omit<CreateCustomerRequest, 'bin'>> & { bin?: string | null };

export interface FindAllCustomersRequest {
  page?: number;
  limit?: number;
  /** Matches name, email or tax id, case-insensitively. */
  search?: string;
}

export interface CustomerResponse {
  id: string;
  name: string;
  email: string;
  address: string;
  taxId?: string;
  bin?: string;
  notes?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface FindAllCustomersResponse {
  items: CustomerResponse[];
  meta: PaginationMeta;
}

export interface DeleteCustomerResponse {
  id: string;
  deleted: true;
}

export interface CustomerIdGatewayRequest {
  id: string;
}

export interface UpdateCustomerGatewayRequest extends CustomerIdGatewayRequest {
  data: UpdateCustomerRequest;
}
