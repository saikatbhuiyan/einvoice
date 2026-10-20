import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { GRPC_CLIENT_TOKENS, GrpcServiceName } from '@libs/transports';
import {
  GrpcMembership,
  MembershipQueryServiceClient,
  ResolveCallerRequest,
  ResolveCallerResponse,
  RoleQueryServiceClient,
} from './grpc-contracts';

const CACHE_KEY_ROLES = 'authorizer:roles';
const CACHE_KEY_MEMBERSHIPS = (userId: string) => `authorizer:memberships:${userId}`;
// Both lookups are cached for a minute: a role change, a new membership or a deactivation takes up
// to this long to apply (tokens are verified per request, but who-may-do-what is cached).
const TTL_MS = 60_000;

/**
 * Decides, per request, which organization the caller acts in and what they may do there.
 *
 * - Organization permissions come from the caller's *membership* (user-access), never from
 *   Keycloak realm roles -- one person can hold different roles in different organizations.
 * - Realm roles still grant *platform* permissions (roles with scope "platform", e.g.
 *   platform-admin), which apply whatever organization is active, or none.
 */
@Injectable()
export class AuthorizationService implements OnModuleInit {
  private readonly logger = new Logger(AuthorizationService.name);
  private roleQueryClient!: RoleQueryServiceClient;
  private membershipQueryClient!: MembershipQueryServiceClient;

  constructor(
    @Inject(GRPC_CLIENT_TOKENS[GrpcServiceName.USER_ACCESS_ROLE_QUERY]) private readonly client: ClientGrpc,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  onModuleInit(): void {
    this.roleQueryClient = this.client.getService<RoleQueryServiceClient>('RoleQueryService');
    this.membershipQueryClient = this.client.getService<MembershipQueryServiceClient>('MembershipQueryService');
  }

  async resolveCaller(request: ResolveCallerRequest): Promise<ResolveCallerResponse> {
    const [platformPermissions, memberships] = await Promise.all([
      this.platformPermissions(request.roles ?? []),
      this.membershipsOf(request.userId),
    ]);
    const summaries = memberships.map(({ organizationId, organizationName, roleName }) => ({
      organizationId,
      organizationName,
      roleName,
    }));

    const active = this.pickMembership(memberships, request.organizationId);
    if (!active.membership) {
      return {
        status: active.status,
        organizationId: '',
        roleName: '',
        permissions: platformPermissions,
        memberships: summaries,
      };
    }

    return {
      status: 'resolved',
      organizationId: active.membership.organizationId,
      roleName: active.membership.roleName,
      permissions: unique([...active.membership.permissions, ...platformPermissions]),
      memberships: summaries,
    };
  }

  private pickMembership(
    memberships: GrpcMembership[],
    requested: string,
  ): { status: ResolveCallerResponse['status']; membership?: GrpcMembership } {
    if (requested) {
      const membership = memberships.find((m) => m.organizationId === requested);
      return membership ? { status: 'resolved', membership } : { status: 'not_member' };
    }
    if (memberships.length === 1) return { status: 'resolved', membership: memberships[0] };
    return { status: memberships.length === 0 ? 'none' : 'ambiguous' };
  }

  private async platformPermissions(realmRoles: string[]): Promise<string[]> {
    if (realmRoles.length === 0) return [];
    const roles = await this.cached(CACHE_KEY_ROLES, async () => {
      const response = await firstValueFrom(this.roleQueryClient.findAllRoles({}));
      return response.roles ?? [];
    });
    const names = new Set(realmRoles);
    return unique(
      roles.filter((role) => role.scope === 'platform' && names.has(role.name)).flatMap((role) => role.permissions),
    );
  }

  private async membershipsOf(userId: string): Promise<GrpcMembership[]> {
    if (!userId) return [];
    return this.cached(CACHE_KEY_MEMBERSHIPS(userId), async () => {
      const response = await firstValueFrom(this.membershipQueryClient.resolveMembership({ keycloakUserId: userId }));
      // proto3 omits empty repeated fields on the wire.
      return (response.memberships ?? []).map((m) => ({ ...m, permissions: m.permissions ?? [] }));
    });
  }

  /** Cache-aside; a Redis failure degrades to calling user-access, never to an error. */
  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    try {
      const hit = await this.cacheManager.get<T>(key);
      if (hit) return hit;
    } catch {
      this.logger.warn(`Cache read failed for key "${key}"`);
    }

    const value = await load();
    try {
      await this.cacheManager.set(key, value, TTL_MS);
    } catch {
      this.logger.warn(`Cache write failed for key "${key}"`);
    }
    return value;
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
