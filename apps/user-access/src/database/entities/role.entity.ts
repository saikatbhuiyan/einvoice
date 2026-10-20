import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * `organization` roles are assigned through memberships and grant permissions inside one
 * organization. `platform` roles are Keycloak realm roles (e.g. platform-admin) and grant
 * cross-organization permissions such as creating organizations -- the only realm roles that still
 * authorize anything.
 */
export const ROLE_SCOPES = ['organization', 'platform'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

@Entity({ name: 'roles' })
export class RoleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string | null;

  /** Permission strings, e.g. "invoice:read", "invoice:write", "product:write". */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  permissions!: string[];

  @Column({ type: 'varchar', length: 16, default: 'organization' })
  scope!: RoleScope;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
