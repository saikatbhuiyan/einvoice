import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Saga, SagaExecutionError } from '@libs/saga';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { buildPaginationMeta } from '@libs/shared/types';
import { KeycloakAdminService } from '@libs/auth/keycloak-admin.service';
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

interface CreateUserSagaContext {
  dto: CreateUserRequest;
  roleName: string;
  firstName: string;
  lastName?: string;
  keycloakUserId?: string;
  createdUser?: UserEntity;
}

const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly roleService: RoleService,
    private readonly keycloakAdminService: KeycloakAdminService,
  ) {}

  /**
   * Provisions the Keycloak identity first, then the local Postgres row, as a Saga
   * (@libs/saga) rather than hand-rolled try/catch: if role assignment fails, the Keycloak user
   * step's own compensate deletes it; if the local write fails afterward, the same compensate
   * runs again -- one compensation path instead of the two duplicated `deleteUser()` call sites
   * this method used to have. Nothing to compensate for creating the Keycloak user itself (it's
   * the first step -- a failure there never committed anything to undo).
   */
  async create(createUserDto: CreateUserRequest): Promise<UserResponse> {
    const role = await this.roleService.getByIdOrThrow(createUserDto.roleId);
    const [firstName, ...rest] = createUserDto.name.trim().split(/\s+/);
    const lastName = rest.length > 0 ? rest.join(' ') : undefined;

    const context: CreateUserSagaContext = { dto: createUserDto, roleName: role.name, firstName, lastName };

    const saga = new Saga<CreateUserSagaContext>('CreateUser');
    saga
      .addStep({
        name: 'createKeycloakUser',
        execute: async (ctx) => {
          ctx.keycloakUserId = await this.keycloakAdminService.createUser({
            username: ctx.dto.email,
            email: ctx.dto.email,
            firstName: ctx.firstName,
            lastName: ctx.lastName,
          });
        },
        // Compensation belongs on the step that created the thing needing undoing, not on
        // whichever later step happens to fail -- a Saga only compensates steps that actually
        // completed, in reverse order, so this runs whether assignRealmRole or persistUser is
        // the one that fails. Deleting the user outright makes a separate "remove the role"
        // compensation for assignRealmRole unnecessary -- there'd be nothing left to remove it
        // from.
        compensate: async (ctx) => {
          await this.keycloakAdminService.deleteUser(ctx.keycloakUserId as string);
        },
      })
      .addStep({
        name: 'assignRealmRole',
        execute: async (ctx) => {
          await this.keycloakAdminService.assignRealmRole(ctx.keycloakUserId as string, ctx.roleName);
        },
      })
      .addStep({
        name: 'persistUser',
        execute: async (ctx) => {
          ctx.createdUser = await this.userRepository.create({
            ...ctx.dto,
            keycloakUserId: ctx.keycloakUserId as string,
          });
        },
      });

    try {
      await saga.execute(context);
    } catch (error) {
      if (error instanceof SagaExecutionError) {
        // The Saga's own bookkeeping is an implementation detail -- callers (and the HTTP
        // exception filter) need to see the original failure type, e.g. a unique-violation
        // QueryFailedError translated to ConflictException below, not a wrapping SagaExecutionError.
        this.handlePersistenceError(error.cause, createUserDto.email);
      }
      throw error;
    }

    return this.toUserResponse(context.createdUser as UserEntity);
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

  /**
   * What actually drives a user's permissions at runtime is the realm role embedded in their
   * Keycloak-issued JWT, not the `roleId` column here — PermissionGuard reads roles straight off
   * the token. Changing roleId without also swapping the Keycloak realm role mapping would leave
   * the two silently out of sync: the API would report the new role while the user's real
   * permissions stayed on the old one until they got a fresh token.
   */
  async update(id: string, updateUserDto: UpdateUserRequest): Promise<UserResponse> {
    const existing = await this.userRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`User not found for id "${id}".`);
    }

    if (updateUserDto.roleId && updateUserDto.roleId !== existing.roleId) {
      const newRole = await this.roleService.getByIdOrThrow(updateUserDto.roleId);

      if (existing.keycloakUserId) {
        await this.keycloakAdminService.removeRealmRole(existing.keycloakUserId, existing.role.name);
        await this.keycloakAdminService.assignRealmRole(existing.keycloakUserId, newRole.name);
      } else {
        this.logger.warn(`User "${id}" has no keycloakUserId — skipping Keycloak realm role sync on role change.`);
      }
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

  /**
   * Also disables the Keycloak account, best-effort — a failure here is logged, not thrown, since
   * the local deactivation succeeding is the primary contract of this call. Note this only stops
   * *new* tokens from being issued; a token already handed out before this call stays valid for
   * its own remaining lifetime (a few minutes) since verification never re-checks Keycloak per
   * request — real-time revocation of already-issued tokens is a separate, not-yet-built piece.
   */
  async deactivate(id: string): Promise<DeactivateUserResponse> {
    const user = await this.userRepository.deactivate(id);
    if (!user) {
      throw new NotFoundException(`User not found for id "${id}".`);
    }

    if (user.keycloakUserId) {
      await this.keycloakAdminService.setEnabled(user.keycloakUserId, false).catch(() => {
        this.logger.error(`Deactivated user "${id}" locally but failed to disable their Keycloak account.`);
      });
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
