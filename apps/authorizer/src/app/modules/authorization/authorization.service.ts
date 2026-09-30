import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { GRPC_CLIENT_TOKENS, GrpcServiceName } from '@libs/transports';
import { GrpcRole, RoleQueryServiceClient } from './grpc-contracts';

const CACHE_KEY_ROLES = 'authorizer:roles';
// Same 60s window UserService.findAllRoles() used to cache this exact data at — this service
// replaces that lookup, not just relocates it, so the request volume it needs to absorb (every
// authenticated bff request) hasn't changed.
const TTL_ROLES_MS = 60_000;

@Injectable()
export class AuthorizationService implements OnModuleInit {
  private readonly logger = new Logger(AuthorizationService.name);
  private roleQueryClient!: RoleQueryServiceClient;

  constructor(
    @Inject(GRPC_CLIENT_TOKENS[GrpcServiceName.USER_ACCESS_ROLE_QUERY]) private readonly client: ClientGrpc,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  onModuleInit(): void {
    this.roleQueryClient = this.client.getService<RoleQueryServiceClient>('RoleQueryService');
  }

  async getPermissionsForRoles(roleNames: string[]): Promise<string[]> {
    const roles = await this.getAllRoles();
    const roleNameSet = new Set(roleNames);
    const permissions = roles.filter((role) => roleNameSet.has(role.name)).flatMap((role) => role.permissions);
    return Array.from(new Set(permissions));
  }

  private async getAllRoles(): Promise<GrpcRole[]> {
    try {
      const cached = await this.cacheManager.get<GrpcRole[]>(CACHE_KEY_ROLES);
      if (cached) return cached;
    } catch {
      this.logger.warn(`Cache read failed for key "${CACHE_KEY_ROLES}"`);
    }

    const response = await firstValueFrom(this.roleQueryClient.findAllRoles({}));
    const roles = response.roles ?? [];

    try {
      await this.cacheManager.set(CACHE_KEY_ROLES, roles, TTL_ROLES_MS);
    } catch {
      this.logger.warn(`Cache write failed for key "${CACHE_KEY_ROLES}"`);
    }

    return roles;
  }
}
