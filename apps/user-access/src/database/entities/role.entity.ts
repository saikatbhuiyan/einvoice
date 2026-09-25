import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { UserEntity } from './user.entity';

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

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => UserEntity, (user) => user.role)
  users?: UserEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
