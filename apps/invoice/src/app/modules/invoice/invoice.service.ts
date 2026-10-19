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
import {
  buildPaginationMeta,
  statusesTransitionableTo,
  type CursorPaginationMeta,
  type InvoiceStatus,
} from '@libs/shared/types';
import type { InvoiceDocument } from '@libs/schemas';
import {
  CreateInvoiceRequest,
  DeleteInvoiceResponse,
  FindAllInvoicesCursorResponse,
  FindAllInvoicesRequest,
  FindAllInvoicesResponse,
  InvoicePdfDownload,
  InvoiceResponse,
  SendInvoiceResponse,
  UpdateInvoiceRequest,
} from '@libs/interfaces/gateway';
import { AuditLogService } from '@libs/audit-log';
import { INVOICE_REPOSITORY, IInvoiceRepository, type InTransaction } from './invoice.repository.interface';
import { PdfGeneratorClientService } from './clients/pdf-generator-client.service';
import { MediaClientService } from './clients/media-client.service';
import { InvoiceEventsProducerService } from './clients/invoice-events-producer.service';

const SVC_PREFIX = 'svc';
const CACHE_KEY_ONE = (id: string) => `${SVC_PREFIX}:invoice:one:${id}`;
const CACHE_KEY_LIST = (version: number, hash: string) => `${SVC_PREFIX}:invoice:list:${version}:${hash}`;
const CACHE_KEY_LIST_VERSION = `${SVC_PREFIX}:invoice:list:version`;

const TTL_ONE_MS = 30_000;
const TTL_LIST_MS = 15_000;

/** A draft is issued on send; issued/overdue can be re-sent (a reminder). */
const SENDABLE_STATUSES: readonly InvoiceStatus[] = ['draft', 'issued', 'overdue'];

const TRANSITION_VERBS: Record<InvoiceStatus, string> = {
  draft: 'revert to draft',
  issued: 'issue',
  paid: 'mark as paid',
  overdue: 'mark as overdue',
  cancelled: 'cancel',
};

const DIFF_IGNORED_FIELDS = new Set(['version', 'updatedAt', 'createdAt', 'id']);

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
    private readonly pdfGeneratorClient: PdfGeneratorClientService,
    private readonly mediaClient: MediaClientService,
    private readonly eventsProducer: InvoiceEventsProducerService,
  ) {
    this.redis = redis;
  }

  async create(createInvoiceDto: CreateInvoiceRequest): Promise<InvoiceResponse> {
    try {
      // Demo event: proves the outbox -> Kafka -> services/mail pipe end to end, independent of the
      // real invoice.sent event this same topic carries (see send below). Written in the insert's
      // transaction, so an idempotent replay (no insert) doesn't emit it again.
      const createdInvoice = await this.invoiceRepository.create(createInvoiceDto, (invoice, session) =>
        this.eventsProducer.enqueueDemo(session, invoice._id.toString()).then(() => undefined),
      );
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
    const previousJson = previous ? (previous.toJSON() as unknown as Record<string, unknown>) : undefined;
    await this.auditLog.record({
      action: 'UPDATE',
      entityType: 'invoice',
      entityId: id,
      diff: previousJson
        ? this.diffFields(previousJson, invoice.toJSON() as unknown as Record<string, unknown>)
        : undefined,
      previous: previousJson,
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

  /** Renders and stores the PDF only, returning a short-lived download URL. Never contacts the client — that is send(). */
  async generatePdf(id: string): Promise<InvoicePdfDownload> {
    const invoice = await this.invoiceRepository.findOne(this.ensureObjectId(id));

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    const stored = await this.renderAndStorePdf(invoice);
    await this.auditLog.record({ action: 'GENERATE_PDF', entityType: 'invoice', entityId: id });

    return this.mediaClient.getDownloadUrl({ key: stored.key, fileName: stored.fileName });
  }

  /** A fresh short-lived URL for the invoice's latest PDF. 404 if none has been rendered yet. */
  async getPdfDownloadUrl(id: string): Promise<InvoicePdfDownload> {
    const invoice = await this.invoiceRepository.findOne(this.ensureObjectId(id));

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    if (!invoice.pdfKey) {
      throw new NotFoundException(`No PDF has been generated for invoice "${id}" yet.`);
    }

    return this.mediaClient.getDownloadUrl({ key: invoice.pdfKey, fileName: pdfFileName(invoice.pdfKey) });
  }

  async issue(id: string): Promise<InvoiceResponse> {
    return this.toInvoiceResponse(await this.transition(id, 'issued'));
  }

  /** Also tells payment (via invoice.cancelled) to close any open checkout session for it. */
  async cancel(id: string): Promise<InvoiceResponse> {
    return this.toInvoiceResponse(
      await this.transition(id, 'cancelled', (invoice, session) =>
        this.eventsProducer
          .enqueueCancelled(session, {
            invoiceId: invoice._id.toString(),
            invoiceNumber: invoice.invoiceNumber,
            cancelledAt: new Date().toISOString(),
          })
          .then(() => undefined),
      ),
    );
  }

  /**
   * Called by payment once Stripe confirms the money moved. Idempotent (Stripe redelivers
   * webhooks); a 409 here means the invoice can't legally become paid — payment flags that for
   * reconciliation rather than retrying.
   */
  async markPaid(id: string): Promise<InvoiceResponse> {
    return this.toInvoiceResponse(await this.transition(id, 'paid'));
  }

  /**
   * Issues the invoice if it is still a draft, renders a fresh PDF (so it shows the issued state —
   * issued invoices are immutable, so it can never be stale afterwards) and has services/mail email
   * it. Re-sending an issued or overdue invoice is allowed (a reminder).
   *
   * The invoice.sent event is written in the same transaction that records the new PDF, so the email
   * goes out if and only if that commit happened — even if Kafka is down right now (the outbox relay
   * publishes it once Kafka is back).
   */
  async send(id: string): Promise<SendInvoiceResponse> {
    const current = await this.invoiceRepository.findOne(this.ensureObjectId(id));

    if (!current) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    if (!SENDABLE_STATUSES.includes(current.status)) {
      throw new ConflictException(`Cannot send an invoice that is ${current.status}.`);
    }

    const invoice = current.status === 'draft' ? await this.transition(id, 'issued') : current;
    const { key, fileName } = await this.renderAndStorePdf(invoice, (stored, session) =>
      this.eventsProducer
        .enqueueSent(session, {
          invoiceId: id,
          invoiceNumber: stored.invoiceNumber,
          clientName: stored.client.name,
          clientEmail: stored.client.email,
          pdfKey: stored.pdfKey as string,
          fileName: pdfFileName(stored.pdfKey as string),
          currency: stored.currency,
          total: stored.total,
          issueDate: stored.issueDate.toISOString(),
          dueDate: stored.dueDate?.toISOString(),
        })
        .then(() => undefined),
    );

    await this.auditLog.record({ action: 'SEND', entityType: 'invoice', entityId: id });

    return {
      invoice: this.toInvoiceResponse(invoice),
      pdf: await this.mediaClient.getDownloadUrl({ key, fileName }),
    };
  }

  /**
   * The one path for every status change. Requesting the status the invoice is already in is a
   * no-op success (safe retries, Stripe redeliveries) and runs no hook; any other illegal change is
   * a 409 naming the current status.
   */
  private async transition(id: string, to: InvoiceStatus, inTransaction?: InTransaction): Promise<InvoiceDocument> {
    const result = await this.invoiceRepository.transitionStatus(
      this.ensureObjectId(id),
      statusesTransitionableTo(to),
      to,
      inTransaction,
    );

    if (result.outcome === 'not_found') {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    if (result.outcome === 'rejected') {
      if (result.invoice.status === to) return result.invoice;
      throw new ConflictException(`Cannot ${TRANSITION_VERBS[to]} an invoice that is ${result.invoice.status}.`);
    }

    await Promise.all([this.delCacheKey(CACHE_KEY_ONE(id)), this.bumpListVersion()]);
    await this.auditLog.record({
      action: 'STATUS_CHANGE',
      entityType: 'invoice',
      entityId: id,
      diff: { status: { from: result.from, to } },
    });

    return result.invoice;
  }

  /**
   * Renders the invoice, stores the PDF (private), and records its key — running `inTransaction`
   * in the same transaction as that record.
   */
  private async renderAndStorePdf(
    invoice: InvoiceDocument,
    inTransaction?: InTransaction,
  ): Promise<{ key: string; fileName: string }> {
    const id = invoice._id.toString();
    const { base64, contentType, fileName } = await this.pdfGeneratorClient.generateInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      client: {
        name: invoice.client.name,
        email: invoice.client.email,
        address: invoice.client.address,
      },
      items: invoice.items.map((item) => ({
        catalogId: item.catalogId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        total: item.total,
      })),
      currency: invoice.currency,
      status: invoice.status,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate?.toISOString(),
      notes: invoice.notes,
      subtotal: invoice.subtotal,
      vatTotal: invoice.vatTotal,
      total: invoice.total,
    });

    const { key } = await this.mediaClient.uploadFile({ fileName, contentType, base64 });

    const stored = await this.invoiceRepository.setPdfMetadata(id, key, new Date(), inTransaction);
    if (!stored) {
      // Only drafts can be deleted, and a draft being rendered can be deleted concurrently.
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }
    await this.delCacheKey(CACHE_KEY_ONE(id));

    return { key, fileName };
  }

  /** Top-level fields whose value changed, as `{ field: { from, to } }`, ignoring bookkeeping fields. */
  private diffFields(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
    const diff: Record<string, unknown> = {};

    for (const field of Object.keys({ ...before, ...after })) {
      if (DIFF_IGNORED_FIELDS.has(field)) continue;
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
        diff[field] = { from: before[field], to: after[field] };
      }
    }

    return diff;
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

/** Keys are `invoices/<uuid>/<fileName>`; the file name is what the browser should save it as. */
function pdfFileName(pdfKey: string): string {
  return pdfKey.split('/').pop() ?? pdfKey;
}
