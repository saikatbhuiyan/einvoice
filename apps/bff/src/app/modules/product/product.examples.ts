import { CreateProductDto, FindAllProductsResponseDto, ProductResponseDto } from '@libs/interfaces/gateway';

export const PRODUCT_ID_EXAMPLE = '3f1b3c9a-7e3d-4a2c-9c1e-6b1a4a9c2f10';

export const CREATE_PRODUCT_EXAMPLE: CreateProductDto = {
  sku: 'SKU-SUBSCRIPTION-PRO',
  name: 'Enterprise subscription',
  description: 'Annual enterprise-tier subscription with priority support.',
  unitPrice: 15000,
  currency: 'BDT',
  vatRate: 15,
};

export const PRODUCT_RESPONSE_EXAMPLE: ProductResponseDto = {
  id: PRODUCT_ID_EXAMPLE,
  ...CREATE_PRODUCT_EXAMPLE,
  isActive: true,
  createdAt: '2026-04-28T10:30:00.000Z',
  updatedAt: '2026-04-28T10:30:00.000Z',
};

export const FIND_ALL_PRODUCTS_RESPONSE_EXAMPLE: FindAllProductsResponseDto = {
  items: [PRODUCT_RESPONSE_EXAMPLE],
  meta: {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};
