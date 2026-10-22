import { ProductEntity } from '../../../database/entities/product.entity';
import { CreateProductRequest, FindAllProductsRequest, UpdateProductRequest } from '@libs/interfaces/gateway';

export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');

export interface PaginatedResult<T = ProductEntity> {
  items: T[];
  total: number;
}

export interface IProductRepository {
  create(data: CreateProductRequest): Promise<ProductEntity>;

  findAll(query: FindAllProductsRequest): Promise<PaginatedResult>;

  findOne(id: string): Promise<ProductEntity | null>;

  /** The organization's products among `ids`; ids that aren't its products are simply absent. */
  findMany(ids: string[]): Promise<ProductEntity[]>;

  /** The updated product, or null if it isn't one of the organization's. */
  update(id: string, data: UpdateProductRequest): Promise<ProductEntity | null>;
}
