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
 * Postgres numeric columns come back as strings (to avoid float precision loss on the driver
 * side). numeric(14,2) and numeric(5,2) values are exact as JS numbers at that scale, and the API
 * speaks decimals; invoice converts a price to exact minor units (@libs/money) when it uses it.
 */
const decimalTransformer: ValueTransformer = {
  to: (value?: number) => value,
  from: (value?: string) => (value === null || value === undefined ? value : Number(value)),
};

/** One organization's catalog entry. A SKU is unique within its organization, not across them. */
@Entity({ name: 'products' })
@Index(['organizationId', 'sku'], { unique: true })
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Every query is scoped by it (ProductRepository). user-access owns organizations: no FK across databases' owners. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

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

  /** Bangladesh supplementary duty (percent of the net amount; VAT is charged on net + SD). */
  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0, transformer: decimalTransformer })
  sdRate!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
