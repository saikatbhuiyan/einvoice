import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { MembershipEntity } from './membership.entity';

/**
 * A tenant: a company that issues invoices. Every piece of business data (invoices, customers,
 * products, payments) belongs to exactly one organization; people take part through memberships.
 */
@Entity({ name: 'organizations' })
export class OrganizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  /** URL-safe, globally unique handle (e.g. for future per-tenant subdomains). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 63 })
  slug!: string;

  /** Prefix of this organization's invoice numbers: `{prefix}-{year}-{seq}`. */
  @Column({ type: 'varchar', length: 10, default: 'INV' })
  invoicePrefix!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany('MembershipEntity', 'organization')
  memberships?: MembershipEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
