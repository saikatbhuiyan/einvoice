import { ProductEntity } from '../../../database/entities/product.entity';
import { CreateProductRequest, FindAllProductsRequest } from '@libs/interfaces/gateway';

export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');

export interface PaginatedResult<T = ProductEntity> {
  items: T[];
  total: number;
}

export interface IProductRepository {
  create(data: CreateProductRequest): Promise<ProductEntity>;

  findAll(query: FindAllProductsRequest): Promise<PaginatedResult>;
}
