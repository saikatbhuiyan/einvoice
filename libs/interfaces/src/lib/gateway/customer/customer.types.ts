import type { PaginationMeta } from '@libs/shared/types';

export interface CreateCustomerRequest {
  name: string;
  email: string;
  address: string;
  taxId?: string;
  notes?: string;
}

export type UpdateCustomerRequest = Partial<CreateCustomerRequest>;

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
