import { RoleEntity } from '../../../database/entities/role.entity';

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

export interface IRoleRepository {
  findAll(): Promise<RoleEntity[]>;

  findById(id: string): Promise<RoleEntity | null>;
}
