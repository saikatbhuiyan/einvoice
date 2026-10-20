import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { containsPattern } from '@libs/shared/utils';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { requireOrganizationId } from '@libs/logging/correlation-context';
import { CreateProductRequest, FindAllProductsRequest } from '@libs/interfaces/gateway';
import { ProductEntity } from '../../../database/entities/product.entity';
import { IProductRepository, PaginatedResult } from './product.repository.interface';

/** The current organization's catalog (requireOrganizationId()); other organizations' products don't exist here. */
@Injectable()
export class ProductRepository implements IProductRepository {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly repository: Repository<ProductEntity>,
  ) {}

  async create(data: CreateProductRequest): Promise<ProductEntity> {
    // Allow-listed: RPC payloads skip DTO validation, so an id or organizationId can't ride along.
    const product = this.repository.create({
      sku: data.sku,
      name: data.name,
      description: data.description,
      unitPrice: data.unitPrice,
      currency: data.currency,
      vatRate: data.vatRate,
      isActive: data.isActive ?? true,
      organizationId: requireOrganizationId(),
    });

    return this.repository.save(product);
  }

  async findAll(query: FindAllProductsRequest): Promise<PaginatedResult<ProductEntity>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const qb = this.repository
      .createQueryBuilder('product')
      .where('product.organizationId = :organizationId', { organizationId: requireOrganizationId() });

    if (query.isActive !== undefined) {
      qb.andWhere('product.isActive = :isActive', { isActive: query.isActive });
    }

    if (query.search) {
      qb.andWhere('(product.sku ILIKE :search OR product.name ILIKE :search)', {
        search: containsPattern(query.search),
      });
    }

    qb.orderBy('product.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();

    return { items, total };
  }
}
