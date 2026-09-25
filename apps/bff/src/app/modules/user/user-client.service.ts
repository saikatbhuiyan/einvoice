import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import {
  CreateUserRequest,
  DeactivateUserResponse,
  FindAllRolesResponse,
  FindAllUsersRequest,
  FindAllUsersResponse,
  UpdateUserRequest,
  UserResponse,
} from '@libs/interfaces/gateway';
import { BaseTcpClient, ServiceName, TCP_CLIENT_TOKENS, TCP_PATTERNS } from '@libs/transports';

@Injectable()
export class UserClientService extends BaseTcpClient {
  protected readonly logger = new Logger(UserClientService.name);
  protected readonly serviceName = ServiceName.USER;
  protected override readonly sourceService = 'bff';

  constructor(
    @Inject(TCP_CLIENT_TOKENS[ServiceName.USER])
    protected readonly client: ClientProxy,
    @Optional() @Inject(CIRCUIT_BREAKER_FACTORY) circuitBreakerFactory?: CircuitBreakerFactory,
  ) {
    super(circuitBreakerFactory);
  }

  async createUser(data: CreateUserRequest): Promise<UserResponse> {
    return this.send<UserResponse, CreateUserRequest>(TCP_PATTERNS.USER.CREATE, data);
  }

  async findAllUsers(query: FindAllUsersRequest): Promise<FindAllUsersResponse> {
    return this.send<FindAllUsersResponse, FindAllUsersRequest>(TCP_PATTERNS.USER.FIND_ALL, query);
  }

  async findOneUser(id: string): Promise<UserResponse> {
    return this.send<UserResponse, { id: string }>(TCP_PATTERNS.USER.FIND_ONE, { id });
  }

  async updateUser(id: string, data: UpdateUserRequest): Promise<UserResponse> {
    return this.send<UserResponse, { id: string; data: UpdateUserRequest }>(TCP_PATTERNS.USER.UPDATE, { id, data });
  }

  async deactivateUser(id: string): Promise<DeactivateUserResponse> {
    return this.send<DeactivateUserResponse, { id: string }>(TCP_PATTERNS.USER.DELETE, { id });
  }

  async findAllRoles(): Promise<FindAllRolesResponse> {
    return this.send<FindAllRolesResponse, undefined>(TCP_PATTERNS.ROLE.FIND_ALL, undefined);
  }
}
