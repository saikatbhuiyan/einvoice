import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { buildPaginationMeta } from '@libs/shared/types';
import {
  CreateUserRequest,
  DeactivateUserResponse,
  FindAllUsersRequest,
  FindAllUsersResponse,
  UpdateUserRequest,
  UserResponse,
} from '@libs/interfaces/gateway';
import { UserEntity } from '../../../database/entities/user.entity';
import { RoleService } from '../role/role.service';
import { IUserRepository, USER_REPOSITORY } from './user.repository.interface';

const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UserService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly roleService: RoleService,
  ) {}

  async create(createUserDto: CreateUserRequest): Promise<UserResponse> {
    await this.roleService.getByIdOrThrow(createUserDto.roleId);

    try {
      const created = await this.userRepository.create(createUserDto);
      return this.toUserResponse(created);
    } catch (error) {
      this.handlePersistenceError(error, createUserDto.email);
    }
  }

  async findAll(query: FindAllUsersRequest): Promise<FindAllUsersResponse> {
    const { items, total } = await this.userRepository.findAll(query);
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    return {
      items: items.map((item) => this.toUserResponse(item)),
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findOne(id: string): Promise<UserResponse> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException(`User not found for id "${id}".`);
    }
    return this.toUserResponse(user);
  }

  async update(id: string, updateUserDto: UpdateUserRequest): Promise<UserResponse> {
    if (updateUserDto.roleId) {
      await this.roleService.getByIdOrThrow(updateUserDto.roleId);
    }

    try {
      const updated = await this.userRepository.update(id, updateUserDto);
      if (!updated) {
        throw new NotFoundException(`User not found for id "${id}".`);
      }
      return this.toUserResponse(updated);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.handlePersistenceError(error, updateUserDto.email ?? id);
    }
  }

  async deactivate(id: string): Promise<DeactivateUserResponse> {
    const user = await this.userRepository.deactivate(id);
    if (!user) {
      throw new NotFoundException(`User not found for id "${id}".`);
    }
    return { id, deactivated: true };
  }

  private toUserResponse(user: UserEntity): UserResponse {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: {
        id: user.role.id,
        name: user.role.name,
        description: user.role.description ?? undefined,
        permissions: user.role.permissions,
        isActive: user.role.isActive,
        createdAt: user.role.createdAt,
        updatedAt: user.role.updatedAt,
      },
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private handlePersistenceError(error: unknown, email: string): never {
    if (this.isUniqueViolation(error)) {
      throw new ConflictException(`User with email "${email}" already exists.`);
    }

    throw error;
  }

  private isUniqueViolation(error: unknown): boolean {
    if (error instanceof QueryFailedError) {
      const driverError = (error as QueryFailedError & { driverError?: { code?: string } }).driverError;
      return driverError?.code === POSTGRES_UNIQUE_VIOLATION;
    }

    return false;
  }
}
