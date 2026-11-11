import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { LedgerApplyState, LedgerEntryKind, LedgerEntryState, PaymentMethod } from '@libs/interfaces/gateway';

// Same string-vs-number boundary conversion as PaymentEntity.amount: numeric is exact in Postgres.
const decimalTransformer = {
  to: (value?: number) => value,
  from: (value?: string) => (value === null || value === undefined ? value : Number(value)),
};

/**
 * One movement of money for an invoice: a payment received or a refund. The record of what
 * happened -- append-only: a correction is another entry, never an edit (only state and apply
 * state move forward). invoice keeps a running total of the applied entries (amountPaidMinor).
 */
@Entity({ name: 'ledger_entries' })
// One payment entry per checkout session: settling the same session twice (webhook retries, the IPN
// and the payer's return racing) finds the entry instead of creating a second.
@Index('UQ_ledger_entries_payment_per_checkout', ['paymentId'], { unique: true, where: `"kind" = 'payment'` })
export class LedgerEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  invoiceId!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: LedgerEntryKind;

  @Column({ type: 'varchar', length: 32 })
  method!: PaymentMethod;

  /** Always positive; the kind says which way the money went. */
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  amount!: number;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 16 })
  state!: LedgerEntryState;

  @Column({ type: 'varchar', length: 16 })
  applyState!: LedgerApplyState;

  /** The checkout session a gateway payment came through (payments.id). */
  @Column({ type: 'uuid', nullable: true })
  paymentId!: string | null;

  /** For a refund: the payment entry it returns money from. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  refundOfEntryId!: string | null;

  /**
   * The provider's own id: for a payment, what a refund is made against (Stripe payment_intent,
   * SSLCommerz bank_tran_id); for a refund, what its status is asked by (Stripe re_…, SSLCommerz
   * refund_ref_id).
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  providerReference!: string | null;

  /** The payer's or bank's reference for money recorded by hand (transfer id, cheque number). */
  @Column({ type: 'varchar', length: 128, nullable: true })
  reference!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  failureReason!: string | null;

  /** When the money moved (a bank transfer's date, not when someone typed it in). */
  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  /** Who recorded it: a user id, or service:<name> for gateway settlements. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  recordedBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
