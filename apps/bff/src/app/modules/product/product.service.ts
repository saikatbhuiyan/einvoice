import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import type express from 'express';
import Redis from 'ioredis';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { REDIS_CLIENT } from '@libs/cache';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import { ServiceName } from '@libs/transports';
import {
  CreateProductRequest,
  FindAllProductsRequest,
  FindAllProductsResponse,
  ProductResponse,
} from '@libs/interfaces/gateway';
import { ProductClientService } from './product-client.service';

const CACHE_KEY_LIST = (version: number, hash: string) => `bff:product:list:${version}:${hash}`;
const CACHE_KEY_LIST_VERSION = 'bff:product:list:version';
const TTL_LIST_MS = 10_000;

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  private readonly redis: Redis;

  constructor(
    private readonly productClient: ProductClientService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(REDIS_CLIENT) redis: Redis,
    @Optional() @Inject(CIRCUIT_BREAKER_FACTORY) private readonly cbFactory?: CircuitBreakerFactory,
  ) {
    this.redis = redis;
  }

  async create(payload: CreateProductRequest): Promise<ProductResponse> {
    const product = await this.productClient.createProduct(payload);
    await this.bumpListVersion();
    return product;
  }

  async findAll(query: FindAllProductsRequest, res?: express.Response): Promise<FindAllProductsResponse> {
    const version = await this.getListVersion();
    const hash = this.hashQuery(query);
    const cacheKey = CACHE_KEY_LIST(version, hash);

    try {
      const cached = await this.cacheManager.get<FindAllProductsResponse>(cacheKey);
      if (cached) return cached;
    } catch {
      this.logger.warn(`Cache read failed for key "${cacheKey}"`);
    }

    try {
      const result = await this.productClient.findAllProducts(query);

      try {
        await this.cacheManager.set(cacheKey, result, TTL_LIST_MS);
      } catch {
        this.logger.warn(`Cache write failed for key "${cacheKey}"`);
      }

      return result;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        const breaker = this.cbFactory?.get(ServiceName.PRODUCT);
        const circuitState = breaker?.getMetrics().state;

        if (circuitState && res) {
          res.setHeader('X-Circuit-State', circuitState);
        }

        try {
          const cached = await this.cacheManager.get<FindAllProductsResponse>(cacheKey);
          if (cached) {
            if (res) {
              res.setHeader('X-Served-From', 'cache');
            }
            this.logger.warn('Circuit open for product service. Returning cached list data.');
            return cached;
          }
        } catch {
          this.logger.warn(`Cache read failed for key "${cacheKey}" during circuit open fallback`);
        }
      }
      throw error;
    }
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
}
