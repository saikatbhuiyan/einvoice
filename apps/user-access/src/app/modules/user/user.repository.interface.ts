import { UserEntity } from '../../../database/entities/user.entity';
import { CreateUserRequest, FindAllUsersRequest, UpdateUserRequest } from '@libs/interfaces/gateway';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface PaginatedResult<T = UserEntity> {
  items: T[];
  total: number;
}

export interface IUserRepository {
  create(data: CreateUserRequest): Promise<UserEntity>;

  findAll(query: FindAllUsersRequest): Promise<PaginatedResult>;

  findById(id: string): Promise<UserEntity | null>;

  update(id: string, data: UpdateUserRequest): Promise<UserEntity | null>;

  deactivate(id: string): Promise<UserEntity | null>;
}
