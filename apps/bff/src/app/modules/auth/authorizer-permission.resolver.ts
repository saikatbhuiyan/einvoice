import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable } from 'rxjs';
import type { CallerResolution, CallerResolutionStatus, PermissionResolver } from '@libs/auth';
import { GRPC_CLIENT_TOKENS, GrpcServiceName } from '@libs/transports';

// Mirrors libs/transports/src/proto/authorizer.proto (hand-written; no codegen).
interface AuthorizerServiceClient {
  resolveCaller(request: { userId: string; roles: string[]; organizationId: string }): Observable<{
    status: string;
    organizationId: string;
    roleName: string;
    permissions: string[];
    memberships: Array<{ organizationId: string; organizationName: string; roleName: string }>;
  }>;
}

const STATUSES: readonly CallerResolutionStatus[] = ['resolved', 'ambiguous', 'none', 'not_member'];

/**
 * PermissionResolver backed by authorizer (gRPC), which looks up the caller's memberships in
 * user-access and caches them. bff never decides organization membership itself.
 */
@Injectable()
export class AuthorizerPermissionResolver implements PermissionResolver, OnModuleInit {
  private authorizerClient!: AuthorizerServiceClient;

  constructor(@Inject(GRPC_CLIENT_TOKENS[GrpcServiceName.AUTHORIZER]) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.authorizerClient = this.client.getService<AuthorizerServiceClient>('AuthorizerService');
  }

  async resolveCaller(
    caller: { userId: string; roles: string[] },
    requestedOrganizationId?: string,
  ): Promise<CallerResolution> {
    const response = await firstValueFrom(
      this.authorizerClient.resolveCaller({
        userId: caller.userId,
        roles: caller.roles,
        organizationId: requestedOrganizationId ?? '',
      }),
    );

    // An unknown status would be a contract break; failing closed beats guessing.
    const status = STATUSES.find((known) => known === response.status) ?? 'none';
    return {
      status,
      organizationId: status === 'resolved' ? response.organizationId || undefined : undefined,
      roleName: response.roleName || undefined,
      // Authorizer already limits these to platform permissions unless resolved.
      permissions: response.permissions ?? [],
      memberships: response.memberships ?? [],
    };
  }
}
