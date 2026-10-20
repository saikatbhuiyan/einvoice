export const PERMISSION_RESOLVER = Symbol('PERMISSION_RESOLVER');

export type CallerResolutionStatus = 'resolved' | 'ambiguous' | 'none' | 'not_member';

export interface CallerMembership {
  organizationId: string;
  organizationName: string;
  roleName: string;
}

/**
 * Who the caller is acting as on this request. `organizationId` and the organization role are set
 * only when status is "resolved"; otherwise `permissions` holds platform permissions alone.
 */
export interface CallerResolution {
  status: CallerResolutionStatus;
  organizationId?: string;
  roleName?: string;
  permissions: string[];
  memberships: CallerMembership[];
}

/**
 * Resolves an authenticated caller (Keycloak subject + realm roles) and the organization they asked
 * to act in (X-Organization-Id, if any) to their active organization and permissions. bff's
 * implementation asks authorizer over gRPC; nothing else depends on how.
 */
export interface PermissionResolver {
  resolveCaller(
    caller: { userId: string; roles: string[] },
    requestedOrganizationId?: string,
  ): Promise<CallerResolution>;
}
