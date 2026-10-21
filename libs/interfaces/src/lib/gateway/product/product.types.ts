import type { PaginationMeta, SupportedCurrency } from '@libs/shared/types';

export { INVOICE_CONSTRAINTS as PRODUCT_CONSTRAINTS, SUPPORTED_CURRENCIES } from '@libs/shared/types';
export type { SupportedCurrency } from '@libs/shared/types';

export interface CreateProductRequest {
  sku: string;
  name: string;
  description?: string;
  unitPrice: number;
  currency: SupportedCurrency;
  vatRate: number;
  /** Bangladesh supplementary duty percentage; defaults to 0. */
  sdRate?: number;
  isActive?: boolean;
}

/**
 * Any subset of a product's fields. Existing invoices keep the values they were created with (lines
 * are snapshots); only new lines see the change.
 */
export type UpdateProductRequest = Partial<CreateProductRequest>;

export interface ProductIdGatewayRequest {
  id: string;
}

export interface UpdateProductGatewayRequest extends ProductIdGatewayRequest {
  data: UpdateProductRequest;
}

/** invoice resolving catalog-backed lines (organization-scoped; unknown ids are simply absent). */
export interface FindManyProductsRequest {
  ids: string[];
}

export interface DeactivateProductResponse {
  id: string;
  deactivated: true;
}

export interface FindAllProductsRequest {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
}

export interface ProductResponse {
  id: string;
  sku: string;
  name: string;
  description?: string;
  unitPrice: number;
  currency: SupportedCurrency;
  vatRate: number;
  /** Bangladesh supplementary duty percentage; 0 elsewhere. */
  sdRate: number;
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface FindAllProductsResponse {
  items: ProductResponse[];
  meta: PaginationMeta;
}
