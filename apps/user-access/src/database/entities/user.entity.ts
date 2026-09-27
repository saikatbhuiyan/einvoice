import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RoleEntity } from './role.entity';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'uuid' })
  roleId!: string;

  // Nullable: users created before KeycloakAdminService existed (or created some other way) have
  // no matching Keycloak identity yet — this column links the two records, not requires it.
  @Column({ type: 'varchar', length: 64, nullable: true })
  keycloakUserId!: string | null;

  @ManyToOne(() => RoleEntity, (role) => role.users, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'roleId' })
  role!: RoleEntity;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
