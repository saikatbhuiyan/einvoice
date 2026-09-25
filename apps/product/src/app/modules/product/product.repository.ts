import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { CreateProductRequest, FindAllProductsRequest } from '@libs/interfaces/gateway';
import { ProductEntity } from '../../../database/entities/product.entity';
import { IProductRepository, PaginatedResult } from './product.repository.interface';

@Injectable()
export class ProductRepository implements IProductRepository {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly repository: Repository<ProductEntity>,
  ) {}

  async create(data: CreateProductRequest): Promise<ProductEntity> {
    const product = this.repository.create({
      ...data,
      isActive: data.isActive ?? true,
    });

    return this.repository.save(product);
  }

  async findAll(query: FindAllProductsRequest): Promise<PaginatedResult<ProductEntity>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const qb = this.repository.createQueryBuilder('product');

    if (query.isActive !== undefined) {
      qb.andWhere('product.isActive = :isActive', { isActive: query.isActive });
    }

    if (query.search) {
      qb.andWhere('(product.sku ILIKE :search OR product.name ILIKE :search)', { search: `%${query.search}%` });
    }

    qb.orderBy('product.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();

    return { items, total };
  }
}
