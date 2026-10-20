import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { MembershipEntity } from './membership.entity';

/**
 * A person (one Keycloak identity). Not tenant-owned: what they may do, and where, comes from their
 * memberships -- one per organization they belong to, each with its own role.
 */
@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  // Nullable: users created before KeycloakAdminService existed (or created some other way) have
  // no matching Keycloak identity yet — this column links the two records, not requires it.
  // Unique: the caller's memberships are resolved by it, so it must identify one person.
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  keycloakUserId!: string | null;

  @OneToMany('MembershipEntity', 'user')
  memberships?: MembershipEntity[];

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
