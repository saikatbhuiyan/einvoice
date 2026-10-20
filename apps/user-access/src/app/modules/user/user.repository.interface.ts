import { FindAllUsersRequest } from '@libs/interfaces/gateway';
import { MembershipEntity } from '../../../database/entities/membership.entity';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface PaginatedResult<T = MembershipEntity> {
  items: T[];
  total: number;
}

export interface MemberChanges {
  /** The person's name (shared by all their organizations). */
  name?: string;
  /** The member's role in this organization. */
  roleId?: string;
  /** Whether the membership is active. */
  isActive?: boolean;
}

/**
 * The members of the *current* organization (requireOrganizationId()): a person appears here only
 * through their membership in it. Every method is scoped -- a member of another organization is
 * "not found", never readable or writable.
 */
export interface IUserRepository {
  findMembers(query: FindAllUsersRequest): Promise<PaginatedResult>;

  findMember(userId: string): Promise<MembershipEntity | null>;

  updateMember(userId: string, changes: MemberChanges): Promise<MembershipEntity | null>;
}
