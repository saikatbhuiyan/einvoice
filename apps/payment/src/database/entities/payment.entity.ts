import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { ValueTransformer } from 'typeorm';

// Same string-vs-number boundary conversion as apps/product's ProductEntity.unitPrice.
const decimalTransformer: ValueTransformer = {
  to: (value?: number) => value,
  from: (value?: string) => (value === null || value === undefined ? value : Number(value)),
};

/**
 * 'reconciliation_required' names a real, distinct state: Stripe confirmed the payment, but the
 * local write that should have told invoice to mark itself paid failed -- deliberately not
 * reverted to 'pending' (which would erase the fact that Stripe already has the money) and not
 * left silently as 'paid' (which would claim invoice agrees when it might not). See
 * PaymentService's saga in handleWebhookEvent.
 */
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'reconciliation_required';

/**
 * At most one open (pending) checkout session per invoice: PaymentService reuses it rather than
 * creating another, and this index is what makes that hold under concurrent requests -- two
 * simultaneous "pay" clicks would otherwise both find nothing open and create two payable sessions.
 */
@Index('UQ_payments_open_session_per_invoice', ['invoiceId'], { unique: true, where: `"status" = 'pending'` })
@Entity({ name: 'payments' })
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The organization the invoice belongs to, recorded when checkout starts. The Stripe webhook has
   * no caller organization, so marking the invoice paid runs in this one (PaymentService).
   */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  invoiceId!: string;

  @Column({ type: 'varchar', length: 32, default: 'stripe' })
  provider!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  providerSessionId!: string;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: PaymentStatus;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  amount!: number;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  checkoutUrl?: string | null;

  /** When the provider session stops accepting payment. Null only for rows created before it was recorded. */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
