import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { REDIS_CLIENT } from '@libs/cache';
import {
  CreateInvoiceRequest,
  DeleteInvoiceResponse,
  FindAllInvoicesCursorResponse,
  FindAllInvoicesRequest,
  FindAllInvoicesResponse,
  InvoiceResponse,
  UpdateInvoiceRequest,
} from '@libs/interfaces/gateway';
import { InvoiceClientService } from './invoice-client.service';

const BFF_PREFIX = 'bff';
const CACHE_KEY_ONE = (id: string) => `${BFF_PREFIX}:invoice:one:${id}`;
const CACHE_KEY_LIST = (version: number, hash: string) => `${BFF_PREFIX}:invoice:list:${version}:${hash}`;
const CACHE_KEY_LIST_VERSION = `${BFF_PREFIX}:invoice:list:version`;

const TTL_ONE_MS = 20_000;
const TTL_LIST_MS = 10_000;

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);
  private readonly redis: Redis;

  constructor(
    private readonly invoiceClient: InvoiceClientService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(REDIS_CLIENT) redis: Redis,
  ) {
    this.redis = redis;
  }

  async findOne(id: string): Promise<InvoiceResponse> {
    const cacheKey = CACHE_KEY_ONE(id);

    try {
      const cached = await this.cacheManager.get<InvoiceResponse>(cacheKey);
      if (cached) return cached;
    } catch {
      this.logger.warn(`Cache read failed for key "${cacheKey}"`);
    }

    const invoice = await this.invoiceClient.findOneInvoice(id);

    try {
      await this.cacheManager.set(cacheKey, invoice, TTL_ONE_MS);
    } catch {
      this.logger.warn(`Cache write failed for key "${cacheKey}"`);
    }

    return invoice;
  }

  async findAll(query: FindAllInvoicesRequest): Promise<FindAllInvoicesResponse | FindAllInvoicesCursorResponse> {
    const version = await this.getListVersion();
    const hash = this.hashQuery(query);
    const cacheKey = CACHE_KEY_LIST(version, hash);

    try {
      const cached = await this.cacheManager.get<FindAllInvoicesResponse>(cacheKey);
      if (cached) return cached;
    } catch {
      this.logger.warn(`Cache read failed for key "${cacheKey}"`);
    }

    const result = await this.invoiceClient.findAllInvoices(query);

    try {
      await this.cacheManager.set(cacheKey, result, TTL_LIST_MS);
    } catch {
      this.logger.warn(`Cache write failed for key "${cacheKey}"`);
    }

    return result;
  }

  async create(payload: CreateInvoiceRequest): Promise<InvoiceResponse> {
    const invoice = await this.invoiceClient.createInvoice(payload);
    await this.bumpListVersion();
    return invoice;
  }

  async update(id: string, payload: UpdateInvoiceRequest): Promise<InvoiceResponse> {
    const invoice = await this.invoiceClient.updateInvoice(id, payload);
    await Promise.all([this.delCacheKey(CACHE_KEY_ONE(id)), this.bumpListVersion()]);
    return invoice;
  }

  async remove(id: string): Promise<DeleteInvoiceResponse> {
    const result = await this.invoiceClient.removeInvoice(id);
    await Promise.all([this.delCacheKey(CACHE_KEY_ONE(id)), this.bumpListVersion()]);
    return result;
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

  private async delCacheKey(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
    } catch {
      this.logger.warn(`Cache delete failed for key "${key}"`);
    }
  }

  private hashQuery(query: FindAllInvoicesRequest): string {
    return createHash('sha256').update(JSON.stringify(query)).digest('hex').slice(0, 16);
  }
}
