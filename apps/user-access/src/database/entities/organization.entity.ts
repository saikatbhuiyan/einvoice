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

  /**
   * Payment reminder schedule: days after an invoice's due date (ascending, see
   * reminderScheduleProblem in @libs/shared/types). Empty = no reminders. Read by invoice's overdue
   * scheduler through ORGANIZATION.INVOICE_SETTINGS.
   */
  @Column({ type: 'int', array: true, default: '{1,7,14}' })
  reminderOffsetsDays!: number[];

  /**
   * Bangladesh Business Identification Number (13 digits). With one, the organization's BDT
   * invoices are Mushak-6.3 tax invoices. Not unique: the same registered business may run more
   * than one workspace.
   */
  @Column({ type: 'varchar', length: 13, nullable: true })
  bin!: string | null;

  /** The challan-issuing address printed on tax invoices. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  address!: string | null;

  /** IANA time zone: printed dates and times of issue, and the invoice-number year. */
  @Column({ type: 'varchar', length: 64, default: 'UTC' })
  timeZone!: string;

  /** The officer-in-charge printed on tax invoices (both set, or neither). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  signatoryName!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  signatoryDesignation!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany('MembershipEntity', 'organization')
  memberships?: MembershipEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
