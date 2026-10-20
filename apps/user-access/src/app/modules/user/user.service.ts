import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { buildPaginationMeta } from '@libs/shared/types';
import { KeycloakAdminService } from '@libs/auth/keycloak-admin.service';
import { requireOrganizationId } from '@libs/logging/correlation-context';
import {
  CreateUserRequest,
  DeactivateUserResponse,
  FindAllUsersRequest,
  FindAllUsersResponse,
  UpdateUserRequest,
  UserResponse,
} from '@libs/interfaces/gateway';
import { MembershipEntity } from '../../../database/entities/membership.entity';
import { RoleService } from '../role/role.service';
import { MemberProvisioningService } from '../membership/member-provisioning.service';
import { MembershipDirectory } from '../membership/membership-directory';
import { IUserRepository, USER_REPOSITORY } from './user.repository.interface';

/**
 * The members of the caller's organization. A "user" here is a person *as a member of this
 * organization*: their role and active flag are the membership's, so the same person can be an
 * admin in one organization and a deactivated viewer in another.
 *
 * Roles are no longer synced to Keycloak realm roles: permissions come from memberships (resolved
 * by authorizer per request), and Keycloak only authenticates.
 */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly roleService: RoleService,
    private readonly provisioning: MemberProvisioningService,
    private readonly directory: MembershipDirectory,
    private readonly keycloakAdminService: KeycloakAdminService,
  ) {}

  async create(createUserDto: CreateUserRequest): Promise<UserResponse> {
    const membership = await this.provisioning.addMember(requireOrganizationId(), createUserDto);
    return this.toUserResponse((await this.userRepository.findMember(membership.userId)) as MembershipEntity);
  }

  async findAll(query: FindAllUsersRequest): Promise<FindAllUsersResponse> {
    const { items, total } = await this.userRepository.findMembers(query);
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    return {
      items: items.map((item) => this.toUserResponse(item)),
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findOne(id: string): Promise<UserResponse> {
    return this.toUserResponse(await this.getMemberOrThrow(id));
  }

  async update(id: string, updateUserDto: UpdateUserRequest): Promise<UserResponse> {
    await this.getMemberOrThrow(id);
    if (updateUserDto.roleId) {
      await this.roleService.getAssignableOrThrow(updateUserDto.roleId);
    }

    const updated = await this.userRepository.updateMember(id, {
      name: updateUserDto.name,
      roleId: updateUserDto.roleId,
      isActive: updateUserDto.isActive,
    });
    if (!updated) {
      throw new NotFoundException(`User not found for id "${id}".`);
    }
    return this.toUserResponse(updated);
  }

  /**
   * Ends the person's membership in *this* organization. Their Keycloak account is disabled only
   * when no active membership is left anywhere -- otherwise one organization could lock someone
   * out of another. Best-effort (logged, not thrown), and it stops new tokens only: one already
   * issued stays valid for its few remaining minutes.
   */
  async deactivate(id: string): Promise<DeactivateUserResponse> {
    const member = await this.getMemberOrThrow(id);
    await this.userRepository.updateMember(id, { isActive: false });

    const remaining = await this.directory.countActiveMemberships(id);
    if (remaining === 0 && member.user?.keycloakUserId) {
      await this.keycloakAdminService.setEnabled(member.user.keycloakUserId, false).catch(() => {
        this.logger.error(`Deactivated user "${id}" locally but failed to disable their Keycloak account.`);
      });
    }

    return { id, deactivated: true };
  }

  private async getMemberOrThrow(id: string): Promise<MembershipEntity> {
    const member = await this.userRepository.findMember(id);
    if (!member) {
      throw new NotFoundException(`User not found for id "${id}".`);
    }
    return member;
  }

  private toUserResponse(member: MembershipEntity): UserResponse {
    const user = member.user as NonNullable<MembershipEntity['user']>;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: {
        id: member.role.id,
        name: member.role.name,
        description: member.role.description ?? undefined,
        permissions: member.role.permissions,
        scope: member.role.scope,
        isActive: member.role.isActive,
        createdAt: member.role.createdAt,
        updatedAt: member.role.updatedAt,
      },
      // Active only if both the membership and the person are.
      isActive: member.isActive && user.isActive,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    };
  }
}
