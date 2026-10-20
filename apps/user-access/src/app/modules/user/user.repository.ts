import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { containsPattern } from '@libs/shared/utils';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { FindAllUsersRequest } from '@libs/interfaces/gateway';
import { requireOrganizationId } from '@libs/logging/correlation-context';
import { MembershipEntity } from '../../../database/entities/membership.entity';
import { UserEntity } from '../../../database/entities/user.entity';
import { IUserRepository, MemberChanges, PaginatedResult } from './user.repository.interface';

@Injectable()
export class UserRepository implements IUserRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findMembers(query: FindAllUsersRequest): Promise<PaginatedResult> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const qb = this.scoped();

    if (query.roleId) {
      qb.andWhere('membership.roleId = :roleId', { roleId: query.roleId });
    }
    if (query.isActive !== undefined) {
      qb.andWhere('membership.isActive = :isActive', { isActive: query.isActive });
    }
    if (query.search) {
      qb.andWhere('(user.name ILIKE :search OR user.email ILIKE :search)', { search: containsPattern(query.search) });
    }

    qb.orderBy('membership.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  findMember(userId: string): Promise<MembershipEntity | null> {
    return this.scoped().andWhere('membership.userId = :userId', { userId }).getOne();
  }

  async updateMember(userId: string, changes: MemberChanges): Promise<MembershipEntity | null> {
    const member = await this.findMember(userId);
    if (!member) return null;

    // Direct UPDATEs, not load+save: saving an entity with loaded (stale) relations makes TypeORM
    // rewrite the join columns from them -- the same trap UserRepository hit with users.roleId.
    await this.dataSource.transaction(async (manager) => {
      if (changes.name !== undefined) {
        await manager.update(UserEntity, { id: userId }, { name: changes.name });
      }
      const membershipChanges = {
        ...(changes.roleId !== undefined && { roleId: changes.roleId }),
        ...(changes.isActive !== undefined && { isActive: changes.isActive }),
      };
      if (Object.keys(membershipChanges).length > 0) {
        await manager.update(MembershipEntity, { id: member.id }, membershipChanges);
      }
    });

    return this.findMember(userId);
  }

  /**
   * The single place this repository applies tenancy. Joins are explicit: eager relations only
   * auto-load for find()/findOne(), not for query builders.
   */
  private scoped(): SelectQueryBuilder<MembershipEntity> {
    return this.dataSource
      .getRepository(MembershipEntity)
      .createQueryBuilder('membership')
      .innerJoinAndSelect('membership.user', 'user')
      .innerJoinAndSelect('membership.role', 'role')
      .innerJoinAndSelect('membership.organization', 'organization')
      .where('membership.organizationId = :organizationId', { organizationId: requireOrganizationId() });
  }
}
