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
  isActive?: boolean;
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
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface FindAllProductsResponse {
  items: ProductResponse[];
  meta: PaginationMeta;
}
