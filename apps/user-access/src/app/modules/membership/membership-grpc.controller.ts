import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { Public } from '@libs/auth/public.decorator';
import { MembershipDirectory } from './membership-directory';

interface GrpcMembership {
  organizationId: string;
  organizationName: string;
  roleName: string;
  permissions: string[];
}

@Controller()
export class MembershipGrpcController {
  constructor(private readonly directory: MembershipDirectory) {}

  // @Public(): authorizer asks on behalf of a caller bff has authenticated but whose organization
  // isn't known yet -- the question this answers. Same service-to-service exception as
  // RoleGrpcController.findAllRoles.
  @Public()
  @GrpcMethod('MembershipQueryService', 'ResolveMembership')
  async resolveMembership({ keycloakUserId }: { keycloakUserId: string }): Promise<{ memberships: GrpcMembership[] }> {
    if (!keycloakUserId) return { memberships: [] };

    const memberships = await this.directory.findActiveMembershipsOf(keycloakUserId);
    return {
      memberships: memberships.map((membership) => ({
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        roleName: membership.role.name,
        // An inactive role grants nothing (it can be deactivated while still assigned).
        permissions: membership.role.isActive ? membership.role.permissions : [],
      })),
    };
  }
}
