export const PERMISSION_RESOLVER = Symbol('PERMISSION_RESOLVER');

/**
 * Resolves the effective permission set for a set of Keycloak realm role names. A Keycloak access
 * token only carries role names (e.g. "accountant"); it doesn't carry that role's fine-grained
 * permissions ("invoice:write", "product:read", ...) — those live in this project's own role data
 * (user-access's seeded RoleEntity.permissions). Implemented by the consuming app, not this lib,
 * since resolving it means reaching into app-specific infrastructure (an RPC call, a cache, a DB).
 */
export interface PermissionResolver {
  getPermissionsForRoles(roleNames: string[]): Promise<string[]>;
}
