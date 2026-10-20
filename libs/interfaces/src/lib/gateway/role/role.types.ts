export interface RoleResponse {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  /** "organization" (assigned through memberships) or "platform" (a Keycloak realm role). */
  scope: 'organization' | 'platform';
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface FindAllRolesResponse {
  items: RoleResponse[];
}
