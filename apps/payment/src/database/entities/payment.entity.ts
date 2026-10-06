import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { ValueTransformer } from 'typeorm';

// Same string-vs-number boundary conversion as apps/product's ProductEntity.unitPrice.
const decimalTransformer: ValueTransformer = {
  to: (value?: number) => value,
  from: (value?: string) => (value === null || value === undefined ? value : Number(value)),
};

export type PaymentStatus = 'pending' | 'paid' | 'failed';

@Entity({ name: 'payments' })
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  invoiceId!: string;

  @Column({ type: 'varchar', length: 32, default: 'stripe' })
  provider!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  providerSessionId!: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: PaymentStatus;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  amount!: number;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  checkoutUrl?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
