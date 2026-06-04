import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Error as MongooseError, isValidObjectId } from 'mongoose';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { REDIS_CLIENT } from '@libs/cache';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { buildPaginationMeta, type CursorPaginationMeta } from '@libs/shared/types';
import {
  CreateInvoiceRequest,
  DeleteInvoiceResponse,
  FindAllInvoicesCursorResponse,
  FindAllInvoicesRequest,
  FindAllInvoicesResponse,
  InvoiceResponse,
  UpdateInvoiceRequest,
} from '@libs/interfaces/gateway';
import { AuditLogService } from '@libs/audit-log';
import { INVOICE_REPOSITORY, IInvoiceRepository, type PaginatedResultMeta } from './invoice.repository.interface';

const SVC_PREFIX = 'svc';
const CACHE_KEY_ONE = (id: string) => `${SVC_PREFIX}:invoice:one:${id}`;
const CACHE_KEY_LIST = (version: number, hash: string) => `${SVC_PREFIX}:invoice:list:${version}:${hash}`;
const CACHE_KEY_LIST_VERSION = `${SVC_PREFIX}:invoice:list:version`;

const TTL_ONE_MS = 30_000;
const TTL_LIST_MS = 15_000;

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);
  private readonly redis: Redis;

  constructor(
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepository: IInvoiceRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(REDIS_CLIENT) redis: Redis,
    private readonly auditLog: AuditLogService,
  ) {
    this.redis = redis;
  }

  async create(createInvoiceDto: CreateInvoiceRequest): Promise<InvoiceResponse> {
    try {
      const createdInvoice = await this.invoiceRepository.create(createInvoiceDto);
      await this.bumpListVersion();
      await this.auditLog.record({
        action: 'CREATE',
        entityType: 'invoice',
        entityId: createdInvoice._id.toString(),
      });
      return this.toInvoiceResponse(createdInvoice);
    } catch (error) {
      this.handlePersistenceError(error);
    }
  }

  async findAll(query: FindAllInvoicesRequest): Promise<FindAllInvoicesResponse | FindAllInvoicesCursorResponse> {
    const version = await this.getListVersion();
    const hash = this.hashQuery(query);
    const cacheKey = CACHE_KEY_LIST(version, hash);

    try {
      const cached = await this.cacheManager.get<FindAllInvoicesResponse | FindAllInvoicesCursorResponse>(cacheKey);
      if (cached) return cached;
    } catch {
      this.logger.warn(`Cache read failed for key "${cacheKey}"`);
    }

    const result = await this.invoiceRepository.findAll(query);
    const items = result.items.map((invoice) => this.toInvoiceResponse(invoice));

    if (result.meta.mode === 'cursor') {
      const cursorMeta = result.meta as CursorPaginationMeta;
      const response: FindAllInvoicesCursorResponse = {
        items,
        meta: {
          limit: cursorMeta.limit,
          hasNextPage: cursorMeta.hasNextPage,
          cursor: cursorMeta.cursor,
        },
      };

      try {
        await this.cacheManager.set(cacheKey, response, TTL_LIST_MS);
      } catch {
        this.logger.warn(`Cache write failed for key "${cacheKey}"`);
      }

      return response;
    }

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const total = result.meta.total;
    const response: FindAllInvoicesResponse = {
      items,
      meta: buildPaginationMeta(page, limit, total),
    };

    try {
      await this.cacheManager.set(cacheKey, response, TTL_LIST_MS);
    } catch {
      this.logger.warn(`Cache write failed for key "${cacheKey}"`);
    }

    return response;
  }

  async findOne(id: string): Promise<InvoiceResponse> {
    const cacheKey = CACHE_KEY_ONE(id);

    try {
      const cached = await this.cacheManager.get<InvoiceResponse>(cacheKey);
      if (cached) return cached;
    } catch {
      this.logger.warn(`Cache read failed for key "${cacheKey}"`);
    }

    const invoice = await this.invoiceRepository.findOne(this.ensureObjectId(id));

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    const response = this.toInvoiceResponse(invoice);

    try {
      await this.cacheManager.set(cacheKey, response, TTL_ONE_MS);
    } catch {
      this.logger.warn(`Cache write failed for key "${cacheKey}"`);
    }

    return response;
  }

  async update(id: string, updateInvoiceDto: UpdateInvoiceRequest, version?: number): Promise<InvoiceResponse> {
    const previous = await this.invoiceRepository.findOne(this.ensureObjectId(id));
    const invoice = await this.invoiceRepository.update(this.ensureObjectId(id), updateInvoiceDto, version);

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    await Promise.all([this.delCacheKey(CACHE_KEY_ONE(id)), this.bumpListVersion()]);
    await this.auditLog.record({
      action: 'UPDATE',
      entityType: 'invoice',
      entityId: id,
      previous: previous ? (previous.toJSON() as unknown as Record<string, unknown>) : undefined,
    });

    return this.toInvoiceResponse(invoice);
  }

  async remove(id: string, version?: number): Promise<DeleteInvoiceResponse> {
    const previous = await this.invoiceRepository.findOne(this.ensureObjectId(id));
    const invoice = await this.invoiceRepository.remove(this.ensureObjectId(id), version);

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    await Promise.all([this.delCacheKey(CACHE_KEY_ONE(id)), this.bumpListVersion()]);
    await this.auditLog.record({
      action: 'DELETE',
      entityType: 'invoice',
      entityId: id,
      previous: previous ? (previous.toJSON() as unknown as Record<string, unknown>) : undefined,
    });

    return {
      id,
      deleted: true,
    };
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

  private ensureObjectId(id: string): string {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`"${id}" is not a valid invoice id.`);
    }

    return id;
  }

  private toInvoiceResponse(invoice: { toJSON(): unknown }): InvoiceResponse {
    return invoice.toJSON() as InvoiceResponse;
  }

  private handlePersistenceError(error: unknown): never {
    if (this.isDuplicateInvoiceNumberError(error)) {
      const invoiceNumber =
        typeof error.keyValue?.invoiceNumber === 'string' ? ` "${error.keyValue.invoiceNumber}"` : '';
      throw new ConflictException(`Invoice number${invoiceNumber} already exists.`);
    }

    if (error instanceof MongooseError.ValidationError) {
      throw new UnprocessableEntityException(this.formatValidationError(error));
    }

    throw error;
  }

  private isDuplicateInvoiceNumberError(
    error: unknown,
  ): error is { code: number; keyPattern?: Record<string, unknown>; keyValue?: Record<string, unknown> } {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const mongoError = error as { code?: unknown; keyPattern?: Record<string, unknown> };
    return mongoError.code === 11000 && Boolean(mongoError.keyPattern?.invoiceNumber);
  }

  private formatValidationError(error: MongooseError.ValidationError): string {
    const messages = Object.values(error.errors)
      .map((validationError) => validationError.message)
      .filter(Boolean);

    return messages.length > 0 ? messages.join(' ') : error.message;
  }
}
