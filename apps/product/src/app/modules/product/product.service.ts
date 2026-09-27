import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { REDIS_CLIENT } from '@libs/cache';
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

// Same shape as invoice.service.ts's own caching (svc prefix, version+hash keyed list cache,
// version bumped on write) — product only exposes create + list today, so there's no per-item
// cache key yet, only the list one.
const SVC_PREFIX = 'svc';
const CACHE_KEY_LIST = (version: number, hash: string) => `${SVC_PREFIX}:product:list:${version}:${hash}`;
const CACHE_KEY_LIST_VERSION = `${SVC_PREFIX}:product:list:version`;
const TTL_LIST_MS = 15_000;

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  private readonly redis: Redis;

  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: IProductRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(REDIS_CLIENT) redis: Redis,
  ) {
    this.redis = redis;
  }

  async create(createProductDto: CreateProductRequest): Promise<ProductResponse> {
    try {
      const created = await this.productRepository.create(createProductDto);
      await this.bumpListVersion();
      return this.toProductResponse(created);
    } catch (error) {
      this.handlePersistenceError(error, createProductDto.sku);
    }
  }

  async findAll(query: FindAllProductsRequest): Promise<FindAllProductsResponse> {
    const version = await this.getListVersion();
    const hash = this.hashQuery(query);
    const cacheKey = CACHE_KEY_LIST(version, hash);

    try {
      const cached = await this.cacheManager.get<FindAllProductsResponse>(cacheKey);
      if (cached) return cached;
    } catch {
      this.logger.warn(`Cache read failed for key "${cacheKey}"`);
    }

    const { items, total } = await this.productRepository.findAll(query);
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const response: FindAllProductsResponse = {
      items: items.map((item) => this.toProductResponse(item)),
      meta: buildPaginationMeta(page, limit, total),
    };

    try {
      await this.cacheManager.set(cacheKey, response, TTL_LIST_MS);
    } catch {
      this.logger.warn(`Cache write failed for key "${cacheKey}"`);
    }

    return response;
  }

  private async getListVersion(): Promise<number> {
    try {
      const version = await this.redis.get(CACHE_KEY_LIST_VERSION);
      return version ? Number(version) : 1;
    } catch {
      this.logger.warn('Failed to read list version counter, defaulting to 1');
      return 1;
    }
  }

  private async bumpListVersion(): Promise<void> {
    try {
      await this.redis.incr(CACHE_KEY_LIST_VERSION);
    } catch {
      this.logger.warn('Failed to increment list version counter');
    }
  }

  private hashQuery(query: FindAllProductsRequest): string {
    return createHash('sha256').update(JSON.stringify(query)).digest('hex').slice(0, 16);
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
