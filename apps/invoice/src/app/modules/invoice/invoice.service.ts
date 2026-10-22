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
import { REDIS_CLIENT, tenantCacheKey } from '@libs/cache';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import {
  INVOICE_CONSTRAINTS,
  buildPaginationMeta,
  localDateTime,
  statusesTransitionableTo,
  type CursorPaginationMeta,
  type InvoiceStatus,
  type SupportedCurrency,
} from '@libs/shared/types';
import { fromMinor } from '@libs/money';
import type { DocumentFormat } from '@libs/transports';
import type { InvoiceDocument, SellerSnapshot } from '@libs/schemas';
import {
  ClientSnapshotRequest,
  CreateInvoiceRequest,
  DeleteInvoiceResponse,
  FindAllInvoicesCursorResponse,
  FindAllInvoicesRequest,
  FindAllInvoicesResponse,
  InvoiceItemRequest,
  OrganizationInvoiceSettings,
  InvoicePdfDownload,
  InvoiceResponse,
  SendInvoiceResponse,
  UpdateInvoiceRequest,
} from '@libs/interfaces/gateway';
import { AuditLogService } from '@libs/audit-log';
import {
  INVOICE_REPOSITORY,
  IInvoiceRepository,
  type InTransaction,
  type TransitionOptions,
} from './invoice.repository.interface';
import { CustomerService } from '../customer/customer.service';
import { InvoiceNumberingService } from './invoice-numbering.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { REMINDER_CATCH_UP_MS, daysOverdue, nextReminderAt } from './reminder-schedule';
import { PdfGeneratorClientService } from './clients/pdf-generator-client.service';
import { MediaClientService } from './clients/media-client.service';
import { InvoiceEventsProducerService } from './clients/invoice-events-producer.service';
import { ProductClientService } from './clients/product-client.service';
import { LineItemError, catalogProductIds, resolveLines, type StoredLine } from './line-items';
import { presentInvoice } from './invoice-presenter';

const SVC_PREFIX = 'svc';
// Tenant-scoped: an invoice id cached for one organization must never be served to another.
const CACHE_KEY_ONE = (id: string) => tenantCacheKey(SVC_PREFIX, 'invoice', 'one', id);
const CACHE_KEY_LIST = (version: number, hash: string) => tenantCacheKey(SVC_PREFIX, 'invoice', 'list', version, hash);
const CACHE_KEY_LIST_VERSION = () => tenantCacheKey(SVC_PREFIX, 'invoice', 'list', 'version');

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
    private readonly customers: CustomerService,
    private readonly numbering: InvoiceNumberingService,
    private readonly settings: OrganizationSettingsService,
    private readonly products: ProductClientService,
  ) {
    this.redis = redis;
  }

  /**
   * A new draft in the caller's organization, billed either to a customer (whose details are
   * snapshotted onto the invoice) or to a one-off client. Unnumbered until issued.
   */
  async create(createInvoiceDto: CreateInvoiceRequest): Promise<InvoiceResponse> {
    const { customerId, client, items, ...rest } = createInvoiceDto;
    // Re-checked here: RPC payloads reach this service without DTO validation.
    if ((customerId === undefined) === (client === undefined)) {
      throw new UnprocessableEntityException('Give either customerId or client, not both and not neither.');
    }
    const snapshot = customerId ? await this.customers.snapshotOf(customerId) : (client as ClientSnapshotRequest);
    const lines = await this.resolveItems(items, rest.currency);

    try {
      // Demo event: proves the outbox -> Kafka -> services/mail pipe end to end, independent of the
      // real invoice.sent event this same topic carries (see send below). Written in the insert's
      // transaction, so an idempotent replay (no insert) doesn't emit it again.
      const createdInvoice = await this.invoiceRepository.create(
        { ...rest, items: lines, client: snapshot, customerId },
        (invoice, session) => this.eventsProducer.enqueueDemo(session, invoice._id.toString()).then(() => undefined),
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
    if (!previous) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    const { items, ...rest } = updateInvoiceDto;
    const currency = rest.currency ?? previous.currency;
    // Prices are amounts *in* a currency: switching currency without restating the lines would
    // silently turn 1,500 BDT into 1,500 USD.
    if (items === undefined && currency !== previous.currency) {
      throw new UnprocessableEntityException(
        `Changing the currency from ${previous.currency} to ${currency} requires sending the items in ${currency} too.`,
      );
    }
    const lines = items === undefined ? undefined : await this.resolveItems(items, currency);

    let invoice: InvoiceDocument | null;
    try {
      invoice = await this.invoiceRepository.update(
        this.ensureObjectId(id),
        lines === undefined ? rest : { ...rest, items: lines },
        version,
      );
    } catch (error) {
      this.handlePersistenceError(error);
    }

    if (!invoice) {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    await Promise.all([this.delCacheKey(CACHE_KEY_ONE(id)), this.bumpListVersion()]);
    const previousJson = previous.toJSON() as unknown as Record<string, unknown>;
    await this.auditLog.record({
      action: 'UPDATE',
      entityType: 'invoice',
      entityId: id,
      diff: this.diffFields(previousJson, invoice.toJSON() as unknown as Record<string, unknown>),
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
    return this.toInvoiceResponse(await this.issueInvoice(id));
  }

  /** Also tells payment (via invoice.cancelled) to close any open checkout session for it. */
  async cancel(id: string): Promise<InvoiceResponse> {
    return this.toInvoiceResponse(
      await this.transition(id, 'cancelled', {
        inTransaction: (invoice, session) =>
          this.eventsProducer
            .enqueueCancelled(session, {
              invoiceId: invoice._id.toString(),
              // Only issued/overdue invoices can be cancelled, and those are numbered.
              invoiceNumber: invoice.invoiceNumber as string,
              cancelledAt: new Date().toISOString(),
            })
            .then(() => undefined),
      }),
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

    const invoice = current.status === 'draft' ? await this.issueInvoice(id) : current;
    const { key, fileName } = await this.renderAndStorePdf(invoice, (stored, session) =>
      this.eventsProducer
        .enqueueSent(session, {
          invoiceId: id,
          // A sent invoice is issued, so it has its number.
          invoiceNumber: stored.invoiceNumber as string,
          clientName: stored.client.name,
          clientEmail: stored.client.email,
          pdfKey: stored.pdfKey as string,
          fileName: pdfFileName(stored.pdfKey as string),
          currency: stored.currency,
          ...eventAmount(stored.totalMinor, stored.currency),
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
   * draft -> issued, assigning the invoice number and issue date in the same transaction (gapless:
   * if the transaction aborts, the number is given back). The issue date is the moment of issue,
   * so within an organization's year numbers and dates always ascend together.
   */
  private async issueInvoice(id: string): Promise<InvoiceDocument> {
    const issuedAt = new Date();
    const numbering = await this.numbering.prepare(issuedAt);
    // "Today" is the organization's: in Dhaka, 03:00 on the 21st is the 21st, though UTC says the 20th.
    const today = localDateTime(issuedAt, numbering.settings.timeZone).date;
    const seller = sellerSnapshot(numbering.settings);

    return this.transition(id, 'issued', {
      prepare: async (current, session) => {
        // A due date is a calendar date, stored as midnight UTC of that date.
        const due = current.dueDate?.toISOString().slice(0, 10);
        if (due && due < today) {
          throw new UnprocessableEntityException(`The due date (${due}) is before today; change it before issuing.`);
        }
        return {
          invoiceNumber: await this.numbering.next(numbering, session),
          issueDate: issuedAt,
          ...(seller ? { seller } : {}),
        };
      },
    });
  }

  /**
   * The one path for every status change. Requesting the status the invoice is already in is a
   * no-op success (safe retries, Stripe redeliveries) and runs no hook; any other illegal change is
   * a 409 naming the current status.
   */
  private async transition(id: string, to: InvoiceStatus, options?: TransitionOptions): Promise<InvoiceDocument> {
    const result = await this.invoiceRepository.transitionStatus(
      this.ensureObjectId(id),
      statusesTransitionableTo(to),
      to,
      options,
    );

    if (result.outcome === 'not_found') {
      throw new NotFoundException(`Invoice not found for id "${id}".`);
    }

    if (result.outcome === 'rejected') {
      if (result.invoice.status === to) return result.invoice;
      throw new ConflictException(`Cannot ${TRANSITION_VERBS[to]} an invoice that is ${result.invoice.status}.`);
    }

    await this.recordTransition(id, result.from, to);
    return result.invoice;
  }

  /** After a committed status change: drop stale cache entries and audit who changed what. */
  private async recordTransition(id: string, from: InvoiceStatus, to: InvoiceStatus): Promise<void> {
    await Promise.all([this.delCacheKey(CACHE_KEY_ONE(id)), this.bumpListVersion()]);
    await this.auditLog.record({
      action: 'STATUS_CHANGE',
      entityType: 'invoice',
      entityId: id,
      diff: { status: { from, to } },
    });
  }

  /**
   * Overdue scheduler (runs inside runAsSystem for the invoice's organization): issued -> overdue,
   * scheduling the first reminder from the organization's schedule. Returns false when there was
   * nothing to do -- the invoice was paid, cancelled or already marked meanwhile; those simply win.
   */
  async markOverdue(id: string, now = new Date()): Promise<boolean> {
    const { reminderOffsetsDays } = await this.settings.current();
    const result = await this.invoiceRepository.transitionStatus(this.ensureObjectId(id), ['issued'], 'overdue', {
      prepare: async (current) => ({
        nextReminderAt: current.dueDate ? nextReminderAt(current.dueDate, reminderOffsetsDays, null, now) : null,
      }),
    });
    if (result.outcome !== 'transitioned') return false;

    await this.recordTransition(id, result.from, 'overdue');
    return true;
  }

  /**
   * Overdue scheduler (inside runAsSystem): handles the reminder that is due for this invoice, if
   * any. A reminder missed by more than REMINDER_CATCH_UP_MS is skipped, never sent late (no bursts
   * on rollout or after an outage). Otherwise it emails the stored PDF -- rendered first if the
   * invoice was issued without one -- by an `invoice.reminder` outbox event written in the same
   * transaction that records the reminder, so each scheduled reminder is sent at most once.
   */
  async sendDueReminder(id: string, now = new Date()): Promise<'sent' | 'skipped' | 'none'> {
    const invoice = await this.invoiceRepository.findOne(this.ensureObjectId(id));
    const scheduledAt = invoice?.nextReminderAt;
    if (!invoice || invoice.status !== 'overdue' || !invoice.dueDate || !scheduledAt || scheduledAt > now) {
      return 'none';
    }

    const { reminderOffsetsDays } = await this.settings.current();

    if (scheduledAt.getTime() < now.getTime() - REMINDER_CATCH_UP_MS) {
      // Skipped: the earliest later reminder that isn't too late yet is next (it may be due now).
      const afterSkip = nextReminderAt(invoice.dueDate, reminderOffsetsDays, scheduledAt, now);
      return (await this.invoiceRepository.advanceReminder(id, scheduledAt, afterSkip, null)) ? 'skipped' : 'none';
    }

    // After sending, the next reminder is strictly after *now*, not merely after `scheduledAt`: whatever
    // value nextReminderAt held (a manual fix, a restored backup), one email is never followed by
    // another on the very next pass.
    const next = nextReminderAt(invoice.dueDate, reminderOffsetsDays, now, now);

    const pdf = invoice.pdfKey
      ? { key: invoice.pdfKey, fileName: pdfFileName(invoice.pdfKey) }
      : await this.renderAndStorePdf(invoice);
    const dueDate = invoice.dueDate;

    const reminded = await this.invoiceRepository.advanceReminder(id, scheduledAt, next, {
      at: now,
      inTransaction: (stored, session) =>
        this.eventsProducer
          .enqueueReminder(session, {
            invoiceId: id,
            invoiceNumber: stored.invoiceNumber as string,
            clientName: stored.client.name,
            clientEmail: stored.client.email,
            pdfKey: pdf.key,
            fileName: pdf.fileName,
            currency: stored.currency,
            ...eventAmount(stored.totalMinor, stored.currency),
            dueDate: dueDate.toISOString(),
            daysOverdue: daysOverdue(dueDate, now),
            reminderNumber: stored.remindersSent,
          })
          .then(() => undefined),
    });
    if (!reminded) return 'none';

    await Promise.all([this.delCacheKey(CACHE_KEY_ONE(id)), this.bumpListVersion()]);
    await this.auditLog.record({
      action: 'REMINDER',
      entityType: 'invoice',
      entityId: id,
      diff: { remindersSent: { from: reminded.remindersSent - 1, to: reminded.remindersSent } },
    });
    return 'sent';
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
    // Issued invoices print the seller as it was when issued; a draft, the organization as it is now.
    // An invoice issued before seller snapshots existed has none and gets none: borrowing today's
    // details could turn an old issued invoice into a tax challan it never was.
    const seller =
      invoice.seller ?? (invoice.status === 'draft' ? sellerSnapshot(await this.settings.current()) : undefined);
    const { base64, contentType, fileName } = await this.pdfGeneratorClient.generateInvoicePdf({
      format: documentFormat(invoice.currency, seller),
      // Drafts have no number yet; their PDF says so.
      invoiceNumber: invoice.invoiceNumber ?? 'DRAFT',
      seller: seller
        ? {
            name: seller.name,
            bin: seller.bin,
            address: seller.address,
            authorizedSignatory: seller.authorizedSignatory
              ? { name: seller.authorizedSignatory.name, designation: seller.authorizedSignatory.designation }
              : undefined,
          }
        : undefined,
      timeZone: seller?.timeZone ?? 'UTC',
      client: {
        name: invoice.client.name,
        email: invoice.client.email,
        address: invoice.client.address,
        bin: invoice.client.bin,
      },
      items: invoice.items.map((item) => ({
        catalogId: item.catalogId,
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        vatRate: item.vatRate,
        sdRate: item.sdRate,
        netMinor: item.netMinor,
        sdMinor: item.sdMinor,
        vatMinor: item.vatMinor,
        totalMinor: item.totalMinor,
      })),
      currency: invoice.currency,
      status: invoice.status,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate?.toISOString(),
      notes: invoice.notes,
      netMinor: invoice.netMinor,
      sdMinor: invoice.sdMinor,
      vatMinor: invoice.vatMinor,
      totalMinor: invoice.totalMinor,
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
      const version = await this.redis.get(CACHE_KEY_LIST_VERSION());
      return version ? Number(version) : 1;
    } catch {
      this.logger.warn('Failed to read list version counter, defaulting to 1');
      return 1;
    }
  }

  private async bumpListVersion(): Promise<void> {
    try {
      await this.redis.incr(CACHE_KEY_LIST_VERSION());
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
    return presentInvoice(invoice.toJSON());
  }

  /**
   * Request lines -> stored lines: catalog lines filled from this organization's products (one
   * lookup for the whole invoice; product scopes it to the caller's organization, so another
   * organization's product is simply "not found").
   */
  private async resolveItems(
    items: InvoiceItemRequest[] | undefined,
    currency: SupportedCurrency,
  ): Promise<StoredLine[]> {
    // Re-checked here: RPC payloads reach this service without DTO validation.
    const { minItems, maxItems } = INVOICE_CONSTRAINTS.items;
    if (!Array.isArray(items) || items.length < minItems || items.length > maxItems) {
      throw new UnprocessableEntityException(`An invoice needs between ${minItems} and ${maxItems} items.`);
    }
    const ids = catalogProductIds(items);
    const products = ids.length > 0 ? await this.products.findMany(ids) : [];
    try {
      return resolveLines(items, currency, new Map(products.map((product) => [product.id, product])));
    } catch (error) {
      if (error instanceof LineItemError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  private handlePersistenceError(error: unknown): never {
    if (error instanceof MongooseError.ValidationError) {
      throw new UnprocessableEntityException(this.formatValidationError(error));
    }

    throw error;
  }

  private formatValidationError(error: MongooseError.ValidationError): string {
    const messages = Object.values(error.errors)
      .map((validationError) => validationError.message)
      .filter(Boolean);

    return messages.length > 0 ? messages.join(' ') : error.message;
  }
}

/**
 * The issuer as a tax invoice records it. None when user-access can't say who the organization is
 * (an older user-access mid-rollout): the invoice then simply has no seller block, as before.
 */
function sellerSnapshot(settings: OrganizationInvoiceSettings): SellerSnapshot | undefined {
  const { issuer, timeZone } = settings;
  if (!issuer?.name) return undefined;
  return {
    name: issuer.name,
    timeZone,
    ...(issuer.bin ? { bin: issuer.bin } : {}),
    ...(issuer.address ? { address: issuer.address } : {}),
    ...(issuer.authorizedSignatory ? { authorizedSignatory: { ...issuer.authorizedSignatory } } : {}),
  };
}

/**
 * Mushak-6.3, the Bangladesh tax invoice, for a BDT invoice from a VAT-registered (BIN-holding)
 * organization; the standard layout for everything else.
 */
export function documentFormat(currency: string, seller: Pick<SellerSnapshot, 'bin'> | undefined): DocumentFormat {
  return currency === 'BDT' && seller?.bin ? 'mushak-6.3' : 'standard';
}

/**
 * Events carry the exact amount (`totalMinor`) and, for consumers that predate it, the decimal
 * `total`. Exact for every supported currency: minor units below 2^53 survive as a double.
 */
function eventAmount(totalMinor: number, currency: string): { total: number; totalMinor: number } {
  return { total: fromMinor(totalMinor, currency as SupportedCurrency), totalMinor };
}

/** Keys are `invoices/<uuid>/<fileName>`; the file name is what the browser should save it as. */
function pdfFileName(pdfKey: string): string {
  return pdfKey.split('/').pop() ?? pdfKey;
}
