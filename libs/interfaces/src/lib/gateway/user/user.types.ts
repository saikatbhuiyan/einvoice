import type { PaginationMeta } from '@libs/shared/types';
import type { RoleResponse } from '../role/role.types';

export interface CreateUserRequest {
  email: string;
  name: string;
  roleId: string;
}

export interface UpdateUserRequest {
  email?: string;
  name?: string;
  roleId?: string;
  isActive?: boolean;
}

export interface FindAllUsersRequest {
  page?: number;
  limit?: number;
  search?: string;
  roleId?: string;
  isActive?: boolean;
}

export interface UserResponse {
  id: string;
  email: string;
  name: string;
  role: RoleResponse;
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface FindAllUsersResponse {
  items: UserResponse[];
  meta: PaginationMeta;
}

export interface UserIdGatewayRequest {
  id: string;
}

export type FindOneUserGatewayRequest = UserIdGatewayRequest;

export type DeactivateUserGatewayRequest = UserIdGatewayRequest;

export interface UpdateUserGatewayRequest extends UserIdGatewayRequest {
  data: UpdateUserRequest;
}

export interface DeactivateUserResponse {
  id: string;
  deactivated: true;
}
