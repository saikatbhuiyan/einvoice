import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
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

  async getByIdOrThrow(id: string): Promise<RoleEntity> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundException(`Role not found for id "${id}".`);
    }
    return role;
  }

  /**
   * A role that may be given to someone *in an organization*: active, and organization-scoped.
   * Platform roles (platform-admin) are Keycloak realm roles and are never assigned through a
   * membership -- otherwise any organization admin could make someone a platform administrator.
   */
  async getAssignableOrThrow(id: string): Promise<RoleEntity> {
    const role = await this.getByIdOrThrow(id);
    if (role.scope !== 'organization' || !role.isActive) {
      throw new UnprocessableEntityException(`Role "${role.name}" cannot be assigned within an organization.`);
    }
    return role;
  }

  async getByNameOrThrow(name: string): Promise<RoleEntity> {
    const role = await this.roleRepository.findByName(name);
    if (!role) {
      throw new NotFoundException(`Role "${name}" does not exist.`);
    }
    return role;
  }

  private toRoleResponse(role: RoleEntity): RoleResponse {
    return {
      id: role.id,
      name: role.name,
      description: role.description ?? undefined,
      permissions: role.permissions,
      scope: role.scope,
      isActive: role.isActive,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
