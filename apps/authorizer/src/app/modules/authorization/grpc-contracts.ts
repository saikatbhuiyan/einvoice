import type { Observable } from 'rxjs';

// Hand-written to match libs/transports/src/proto/{user-access,authorizer}.proto (no codegen; see
// CLAUDE.md's gRPC section). Keep in sync with the .proto files.

export interface GrpcRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isActive: boolean;
  /** "organization" | "platform". */
  scope: string;
}

export interface RoleQueryServiceClient {
  findAllRoles(request: Record<string, never>): Observable<{ roles: GrpcRole[] }>;
}

export interface GrpcMembership {
  organizationId: string;
  organizationName: string;
  roleName: string;
  permissions: string[];
}

export interface MembershipQueryServiceClient {
  resolveMembership(request: { keycloakUserId: string }): Observable<{ memberships: GrpcMembership[] }>;
}

export interface ResolveCallerRequest {
  userId: string;
  roles: string[];
  /** Empty string = none requested (proto3 has no undefined). */
  organizationId: string;
}

export type CallerStatus = 'resolved' | 'ambiguous' | 'none' | 'not_member';

export interface ResolveCallerResponse {
  status: CallerStatus;
  organizationId: string;
  roleName: string;
  permissions: string[];
  memberships: Array<{ organizationId: string; organizationName: string; roleName: string }>;
}
