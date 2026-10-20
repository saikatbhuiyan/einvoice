export interface AuthenticatedUser {
  sub: string;
  username: string;
  email?: string;
  roles: string[];
  permissions?: string[];
  /** The organization this request acts in, once PermissionGuard has resolved it. */
  organizationId?: string;
  /** Every organization the caller belongs to (for GET /me and error messages). */
  memberships?: Array<{ organizationId: string; organizationName: string; roleName: string }>;
}
