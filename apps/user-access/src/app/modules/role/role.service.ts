import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { FindAllRolesResponse, RoleResponse } from '@libs/interfaces/gateway';
import { RoleEntity } from '../../../database/entities/role.entity';
import { IRoleRepository, ROLE_REPOSITORY } from './role.repository.interface';

@Injectable()
export class RoleService {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepository: IRoleRepository,
  ) {}

  async findAll(): Promise<FindAllRolesResponse> {
    const roles = await this.roleRepository.findAll();
    return { items: roles.map((role) => this.toRoleResponse(role)) };
  }

  /** Used by UserService to validate a roleId before assigning it and to embed the role in a UserResponse. */
  async getByIdOrThrow(id: string): Promise<RoleEntity> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundException(`Role not found for id "${id}".`);
    }
    return role;
  }

  private toRoleResponse(role: RoleEntity): RoleResponse {
    return {
      id: role.id,
      name: role.name,
      description: role.description ?? undefined,
      permissions: role.permissions,
      isActive: role.isActive,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
