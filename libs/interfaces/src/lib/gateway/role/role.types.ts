export interface RoleResponse {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface FindAllRolesResponse {
  items: RoleResponse[];
}
