import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MembershipEntity } from '../../../database/entities/membership.entity';
import { UserEntity } from '../../../database/entities/user.entity';

export interface NewPerson {
  email: string;
  name: string;
  keycloakUserId: string;
}

/**
 * Cross-organization access to people and memberships -- deliberately separate from the
 * tenant-scoped UserRepository, and every method takes the organization explicitly. Its callers
 * are the two jobs that must work across organizations: resolving which organizations a caller
 * belongs to (before any organization is known), and adding a person to a given organization
 * (including a brand-new one, during its creation).
 */
@Injectable()
export class MembershipDirectory {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Active memberships of an active person in active organizations, oldest first. */
  findActiveMembershipsOf(keycloakUserId: string): Promise<MembershipEntity[]> {
    return this.dataSource
      .getRepository(MembershipEntity)
      .createQueryBuilder('membership')
      .innerJoin('membership.user', 'user')
      .innerJoinAndSelect('membership.organization', 'organization')
      .innerJoinAndSelect('membership.role', 'role')
      .where('user.keycloakUserId = :keycloakUserId', { keycloakUserId })
      .andWhere('user.isActive = true')
      .andWhere('membership.isActive = true')
      .andWhere('organization.isActive = true')
      .orderBy('membership.createdAt', 'ASC')
      .getMany();
  }

  // Case-insensitive: rows created before emails were normalised keep whatever case was typed.
  findPersonByEmail(email: string): Promise<UserEntity | null> {
    return this.dataSource
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();
  }

  findMembership(userId: string, organizationId: string): Promise<MembershipEntity | null> {
    return this.dataSource.getRepository(MembershipEntity).findOne({
      where: { userId, organizationId },
      relations: { user: true },
    });
  }

  /** Inserts the person and their first membership atomically. */
  async createPersonWithMembership(
    person: NewPerson,
    organizationId: string,
    roleId: string,
  ): Promise<MembershipEntity> {
    const membershipId = await this.dataSource.transaction(async (manager) => {
      const user = await manager.save(manager.create(UserEntity, { ...person, email: person.email.toLowerCase() }));
      const membership = await manager.save(
        manager.create(MembershipEntity, { userId: user.id, organizationId, roleId }),
      );
      return membership.id;
    });
    return this.getMembership(membershipId);
  }

  async addMembership(userId: string, organizationId: string, roleId: string): Promise<MembershipEntity> {
    const repository = this.dataSource.getRepository(MembershipEntity);
    const membership = await repository.save(repository.create({ userId, organizationId, roleId }));
    return this.getMembership(membership.id);
  }

  countActiveMemberships(userId: string): Promise<number> {
    return this.dataSource.getRepository(MembershipEntity).count({ where: { userId, isActive: true } });
  }

  // save() doesn't load relations onto what it returns; callers need user, role and organization.
  private async getMembership(id: string): Promise<MembershipEntity> {
    return this.dataSource.getRepository(MembershipEntity).findOneOrFail({ where: { id }, relations: { user: true } });
  }
}
