import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { buildPaginationMeta } from '@libs/shared/types';
import {
  CreateProductRequest,
  FindAllProductsRequest,
  FindAllProductsResponse,
  ProductResponse,
} from '@libs/interfaces/gateway';
import { ProductEntity } from '../../../database/entities/product.entity';
import { IProductRepository, PRODUCT_REPOSITORY } from './product.repository.interface';

const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ProductService {
  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: IProductRepository,
  ) {}

  async create(createProductDto: CreateProductRequest): Promise<ProductResponse> {
    try {
      const created = await this.productRepository.create(createProductDto);
      return this.toProductResponse(created);
    } catch (error) {
      this.handlePersistenceError(error, createProductDto.sku);
    }
  }

  async findAll(query: FindAllProductsRequest): Promise<FindAllProductsResponse> {
    const { items, total } = await this.productRepository.findAll(query);
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    return {
      items: items.map((item) => this.toProductResponse(item)),
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  private toProductResponse(product: ProductEntity): ProductResponse {
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description ?? undefined,
      unitPrice: product.unitPrice,
      currency: product.currency,
      vatRate: product.vatRate,
      isActive: product.isActive,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private handlePersistenceError(error: unknown, sku: string): never {
    if (this.isUniqueViolation(error)) {
      throw new ConflictException(`Product with sku "${sku}" already exists.`);
    }

    throw error;
  }

  private isUniqueViolation(error: unknown): boolean {
    if (error instanceof QueryFailedError) {
      const driverError = (error as QueryFailedError & { driverError?: { code?: string } }).driverError;
      return driverError?.code === POSTGRES_UNIQUE_VIOLATION;
    }

    return false;
  }
}
