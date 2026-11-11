import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { formatMoney, fromMinor, toMinor } from '@libs/money';
import type { SupportedCurrency } from '@libs/shared/types';
import { getCurrentCorrelationContext, requireOrganizationId } from '@libs/logging/correlation-context';
import {
  MANUAL_PAYMENT_METHODS,
  type InvoiceResponse,
  type LedgerEntryResponse,
  type RecordPaymentRequest,
  type RefundRequest,
} from '@libs/interfaces/gateway';
import { LedgerEntryEntity } from '../../../../database/entities/ledger-entry.entity';
import { PaymentEntity } from '../../../../database/entities/payment.entity';
import { InvoiceClientService } from '../invoice-client.service';
import { balanceDueOf } from '../invoice-amounts';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { RefundOutcomeUnknownError } from '../payment-provider.interface';

const PG_UNIQUE_VIOLATION = '23505';

/** Online methods are refunded through their provider; everything else was paid by hand. */
const ONLINE_METHODS = new Set(['stripe', 'sslcommerz']);

/** A refund in one of these states counts against what can still be refunded from its payment. */
const COMMITTED_REFUND_STATES = ['settled', 'pending', 'unknown'] as const;

/** Payments a person may record by hand are only taken on an invoice that is owed. */
const PAYABLE_INVOICE_STATUSES = ['issued', 'overdue'];

/** What applying an entry to its invoice did. */
export type ApplyOutcome =
  | { outcome: 'applied'; invoice: InvoiceResponse }
  /** invoice refused the money for good (a draft, a cancelled invoice): a refund is owed. */
  | { outcome: 'refused'; reason: string }
  /** invoice couldn't be reached: the worker retries. */
  | { outcome: 'retry' };

/**
 * The payments ledger: every movement of money for an invoice, append-only, in exact numeric
 * amounts. invoice keeps a running total of the entries applied to it (APPLY_LEDGER_ENTRY,
 * idempotent by entry id); this service decides when an entry counts.
 *
 * Queries are scoped to the current organization (requireOrganizationId()), except the worker's
 * scans (pendingApplications, pendingRefunds), which run across organizations and then act inside
 * each entry's own one.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    @InjectRepository(LedgerEntryEntity) private readonly entries: Repository<LedgerEntryEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly invoiceClient: InvoiceClientService,
    private readonly providers: PaymentProviderRegistry,
  ) {}

  /** The invoice's ledger, oldest first, each payment with how much of it has been refunded. */
  async list(invoiceId: string): Promise<LedgerEntryResponse[]> {
    const rows = await this.entries.find({
      where: { organizationId: requireOrganizationId(), invoiceId },
      order: { occurredAt: 'ASC', createdAt: 'ASC' },
    });
    const refunded = new Map<string, number>();
    for (const row of rows) {
      if (row.kind === 'refund' && row.refundOfEntryId && COMMITTED_REFUND_STATES.includes(row.state as never)) {
        refunded.set(row.refundOfEntryId, (refunded.get(row.refundOfEntryId) ?? 0) + this.minor(row));
      }
    }
    return rows.map((row) => this.toResponse(row, refunded.get(row.id)));
  }

  /**
   * A gateway payment settled for a checkout session. Idempotent: the same session (webhook
   * retries, the IPN and the payer's return racing) finds its entry instead of making a second.
   * `amount` is what the provider confirmed was paid; `held` keeps it off the invoice until a person
   * accepts it (high risk); `refused` records money that can't go on the invoice (an amount mismatch).
   */
  async recordGatewayPayment(
    payment: PaymentEntity,
    details: { providerReference?: string; amount?: number; applyState?: 'pending' | 'held' | 'refused' },
  ): Promise<LedgerEntryEntity> {
    try {
      return await this.entries.save(
        this.entries.create({
          organizationId: payment.organizationId,
          invoiceId: payment.invoiceId,
          kind: 'payment',
          method: payment.provider as LedgerEntryEntity['method'],
          amount: details.amount ?? payment.amount,
          currency: payment.currency,
          state: 'settled',
          applyState: details.applyState ?? 'pending',
          paymentId: payment.id,
          providerReference: details.providerReference ?? null,
          occurredAt: new Date(),
          recordedBy: `service:${payment.provider}`,
        }),
      );
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const existing = await this.entries.findOne({ where: { kind: 'payment', paymentId: payment.id } });
      if (!existing) throw error;
      return existing;
    }
  }

  /** The payment entry a checkout session settled into, if any. */
  findForCheckout(paymentId: string): Promise<LedgerEntryEntity | null> {
    return this.entries.findOne({ where: { organizationId: requireOrganizationId(), kind: 'payment', paymentId } });
  }

  /**
   * Counts a settled entry on its invoice. A deterministic refusal (404/409: the invoice can't take
   * money) is final -- the entry is marked refused, and a refund is owed; anything else is retried
   * by the worker. Must run in the entry's organization.
   */
  async apply(entry: LedgerEntryEntity): Promise<ApplyOutcome> {
    try {
      const invoice = await this.invoiceClient.applyLedgerEntry(entry.invoiceId, {
        entryId: entry.id,
        kind: entry.kind,
        amountMinor: this.minor(entry),
      });
      await this.entries.update({ id: entry.id }, { applyState: 'applied' });
      entry.applyState = 'applied';
      return { outcome: 'applied', invoice };
    } catch (error) {
      if (error instanceof HttpException && [HttpStatus.NOT_FOUND, HttpStatus.CONFLICT].includes(error.getStatus())) {
        await this.entries.update({ id: entry.id }, { applyState: 'refused', failureReason: error.message });
        entry.applyState = 'refused';
        this.logger.error(
          `Ledger ${entry.kind} ${entry.id} (${entry.amount} ${entry.currency}) can't be counted on invoice "${entry.invoiceId}": ${error.message} -- a refund is owed.`,
        );
        return { outcome: 'refused', reason: error.message };
      }
      this.logger.warn(
        `Applying ledger ${entry.kind} ${entry.id} failed for now (${(error as Error).message}); retrying later.`,
      );
      return { outcome: 'retry' };
    }
  }

  /** Money received outside the gateways (a bank transfer, a cheque, cash...), recorded by a person. */
  async recordManual(invoiceId: string, request: RecordPaymentRequest): Promise<LedgerEntryResponse> {
    const { amount, method, occurredAt, reference, note } = request ?? ({} as RecordPaymentRequest);
    if (!(MANUAL_PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw new BadRequestException(`method must be one of ${MANUAL_PAYMENT_METHODS.join(', ')}.`);
    }
    const when = this.parseOccurredAt(occurredAt);

    const invoice = await this.invoiceClient.findOneInvoice(invoiceId);
    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
      throw new ConflictException(`Cannot record a payment on an invoice that is ${invoice.status}.`);
    }
    const currency = invoice.currency as SupportedCurrency;
    const amountMinor = this.positiveMinor(amount, currency);
    const balanceMinor = toMinor(balanceDueOf(invoice), currency);
    if (amountMinor > balanceMinor) {
      throw new UnprocessableEntityException(
        `${formatMoney(amountMinor, currency)} is more than the balance due (${formatMoney(balanceMinor, currency)}).`,
      );
    }

    const entry = await this.entries.save(
      this.entries.create({
        organizationId: requireOrganizationId(),
        invoiceId,
        kind: 'payment',
        method,
        amount: fromMinor(amountMinor, currency),
        currency,
        state: 'settled',
        applyState: 'pending',
        reference: this.text(reference, 128),
        note: this.text(note, 500),
        occurredAt: when,
        recordedBy: this.actor(),
      }),
    );
    await this.apply(entry);
    return this.toResponse(entry, 0);
  }

  /**
   * Returns money from one payment: through its provider for an online payment (unless it was
   * already returned outside the system), recorded as returned for one paid by hand.
   *
   * What can still be refunded is checked under a row lock on the payment -- SSLCommerz itself
   * accepts refunds beyond the transaction's total (probed), so two concurrent refunds must not both
   * pass the check. The refund is recorded before the provider is called, and an SSLCommerz refund
   * whose outcome is lost is never retried (a repeated call refunds twice): it becomes "unknown".
   */
  async refund(invoiceId: string, request: RefundRequest): Promise<LedgerEntryResponse> {
    const { paymentEntryId, amount, reason, returnedOutsideSystem } = request ?? ({} as RefundRequest);
    if (typeof paymentEntryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(paymentEntryId)) {
      throw new BadRequestException('paymentEntryId must be a payment ledger entry id.');
    }
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 255) {
      throw new BadRequestException('reason must be 3-255 characters.');
    }
    const organizationId = requireOrganizationId();

    const { refund, payment } = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(LedgerEntryEntity);
      const payment = await repository.findOne({
        where: { id: paymentEntryId, organizationId, invoiceId, kind: 'payment' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException(`No payment "${paymentEntryId}" on invoice "${invoiceId}".`);
      if (payment.state !== 'settled')
        throw new ConflictException(`Payment "${paymentEntryId}" is ${payment.state}, not settled.`);

      const currency = payment.currency as SupportedCurrency;
      const amountMinor = this.positiveMinor(amount, currency);
      const refunds = await repository.find({
        where: { refundOfEntryId: payment.id, kind: 'refund', state: In([...COMMITTED_REFUND_STATES]) },
      });
      const remainingMinor = this.minor(payment) - refunds.reduce((sum, row) => sum + this.minor(row), 0);
      if (amountMinor > remainingMinor) {
        throw new UnprocessableEntityException(
          `At most ${formatMoney(remainingMinor, currency)} of this payment can still be refunded.`,
        );
      }

      const online = ONLINE_METHODS.has(payment.method) && !returnedOutsideSystem;
      if (online && !payment.providerReference) {
        throw new UnprocessableEntityException(
          "This payment predates the payments ledger and has no provider reference: refund it in the provider's dashboard, then record the refund with returnedOutsideSystem: true.",
        );
      }

      const refund = await repository.save(
        repository.create({
          organizationId,
          invoiceId,
          kind: 'refund',
          method: payment.method,
          amount: fromMinor(amountMinor, currency),
          currency,
          state: online ? 'pending' : 'settled',
          // Only a payment that counted on the invoice is taken off it again.
          applyState: payment.applyState === 'applied' ? 'pending' : 'not_applicable',
          refundOfEntryId: payment.id,
          note: reason.trim(),
          occurredAt: new Date(),
          recordedBy: this.actor(),
        }),
      );
      return { refund, payment };
    });

    if (refund.state === 'pending') {
      await this.executeRefund(refund, payment);
    } else if (refund.applyState === 'pending') {
      await this.apply(refund);
    }
    return this.toResponse(refund);
  }

  /** Asks the provider to make a recorded refund, and records where it stands. */
  async executeRefund(refund: LedgerEntryEntity, payment: LedgerEntryEntity): Promise<void> {
    const provider = this.providers.byName(payment.method);
    try {
      const result = await provider.refund({
        paymentReference: payment.providerReference as string,
        amount: refund.amount,
        currency: refund.currency,
        refundId: refund.id,
        reason: refund.note ?? 'Refund',
      });
      await this.recordRefundState(refund, result);
    } catch (error) {
      if (!(error instanceof RefundOutcomeUnknownError)) throw error;
      if (provider.refundsAreIdempotent) {
        // Stripe de-duplicates by our entry id: the worker repeats the call.
        this.logger.warn(`Refund ${refund.id}: ${error.message}; retrying later.`);
        return;
      }
      await this.entries.update({ id: refund.id }, { state: 'unknown', failureReason: error.message });
      refund.state = 'unknown';
      this.logger.error(
        `Refund ${refund.id} of ${refund.amount} ${refund.currency} on invoice "${refund.invoiceId}": ${error.message}. It may or may not have been made, and can't be retried safely -- check the ${provider.name} panel.`,
      );
    }
  }

  /** Records a provider's answer about a refund; a settled one is taken off the invoice. */
  async recordRefundState(
    refund: LedgerEntryEntity,
    result: { state: 'settled' | 'pending' | 'failed'; providerReference?: string; failureReason?: string },
  ): Promise<void> {
    await this.entries.update(
      { id: refund.id },
      {
        state: result.state,
        ...(result.providerReference ? { providerReference: result.providerReference } : {}),
        ...(result.failureReason ? { failureReason: result.failureReason } : {}),
      },
    );
    refund.state = result.state;
    if (result.providerReference) refund.providerReference = result.providerReference;
    if (result.state === 'settled' && refund.applyState === 'pending') await this.apply(refund);
    if (result.state === 'failed') {
      this.logger.warn(`Refund ${refund.id} failed at ${refund.method}: ${result.failureReason}`);
    }
  }

  /** Worker: settled entries invoice hasn't counted yet (across organizations). */
  pendingApplications(limit: number): Promise<LedgerEntryEntity[]> {
    return this.entries.find({
      where: { state: 'settled', applyState: 'pending' },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /** Worker: refunds still in progress at a provider (across organizations). */
  pendingRefunds(limit: number): Promise<LedgerEntryEntity[]> {
    return this.entries.find({ where: { kind: 'refund', state: 'pending' }, order: { createdAt: 'ASC' }, take: limit });
  }

  /** Worker: the payment a refund returns money from. */
  findPaymentOf(refund: LedgerEntryEntity): Promise<LedgerEntryEntity | null> {
    return this.entries.findOne({ where: { id: refund.refundOfEntryId as string } });
  }

  /** A held (high-risk) payment accepted by a person: it counts on the invoice now. */
  async release(entry: LedgerEntryEntity): Promise<ApplyOutcome> {
    await this.entries.update({ id: entry.id }, { applyState: 'pending' });
    entry.applyState = 'pending';
    return this.apply(entry);
  }

  /** How much of a payment can still be refunded, in its currency's minor units. */
  async refundableMinor(payment: LedgerEntryEntity): Promise<number> {
    const refunds = await this.entries.find({
      where: { refundOfEntryId: payment.id, kind: 'refund', state: In([...COMMITTED_REFUND_STATES]) },
    });
    return this.minor(payment) - refunds.reduce((sum, row) => sum + this.minor(row), 0);
  }

  toResponse(row: LedgerEntryEntity, refundedMinor?: number): LedgerEntryResponse {
    const currency = row.currency as SupportedCurrency;
    return {
      id: row.id,
      invoiceId: row.invoiceId,
      kind: row.kind,
      method: row.method,
      amount: row.amount,
      currency: row.currency,
      state: row.state,
      applyState: row.applyState,
      ...(row.refundOfEntryId ? { refundOfEntryId: row.refundOfEntryId } : {}),
      ...(row.kind === 'payment' ? { refundedAmount: fromMinor(refundedMinor ?? 0, currency) } : {}),
      ...(row.reference ? { reference: row.reference } : {}),
      ...(row.note ? { note: row.note } : {}),
      ...(row.failureReason ? { failureReason: row.failureReason } : {}),
      occurredAt: row.occurredAt,
      ...(row.recordedBy ? { recordedBy: row.recordedBy } : {}),
      createdAt: row.createdAt,
    };
  }

  private minor(row: Pick<LedgerEntryEntity, 'amount' | 'currency'>): number {
    return toMinor(row.amount, row.currency as SupportedCurrency);
  }

  /** A positive amount in the currency's minor units; refuses more decimals than it has (422). */
  private positiveMinor(amount: unknown, currency: SupportedCurrency): number {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount must be a positive number.');
    }
    try {
      return toMinor(amount, currency);
    } catch (error) {
      throw new UnprocessableEntityException((error as Error).message);
    }
  }

  /** When money was received: a real date, not in the future (a day's slack for time zones). */
  private parseOccurredAt(value: unknown): Date {
    const when = typeof value === 'string' ? new Date(value) : new Date(NaN);
    if (Number.isNaN(when.getTime())) throw new BadRequestException('occurredAt must be an ISO date or date-time.');
    if (when.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      throw new UnprocessableEntityException('occurredAt is in the future.');
    }
    return when;
  }

  private text(value: unknown, max: number): string | null {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
  }

  private actor(): string | null {
    const context = getCurrentCorrelationContext();
    return context?.userId ?? (context?.systemActor ? `system:${context.systemActor}` : null);
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === PG_UNIQUE_VIOLATION
    );
  }
}
