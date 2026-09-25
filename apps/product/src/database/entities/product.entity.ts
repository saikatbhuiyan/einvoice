import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';
import type { SupportedCurrency } from '@libs/interfaces/gateway';

/**
 * Postgres numeric columns come back as strings (to avoid float precision loss on the
 * driver side). The rest of the codebase treats money as JS numbers (see the invoice
 * schema's rounding), so convert at the persistence boundary instead of leaking strings.
 */
const decimalTransformer: ValueTransformer = {
  to: (value?: number) => value,
  from: (value?: string) => (value === null || value === undefined ? value : Number(value)),
};

@Entity({ name: 'products' })
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  sku!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description?: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  unitPrice!: number;

  @Column({ type: 'varchar', length: 3 })
  currency!: SupportedCurrency;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0, transformer: decimalTransformer })
  vatRate!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
