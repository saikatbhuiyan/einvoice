import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable } from 'rxjs';
import type { PermissionResolver } from '@libs/auth';
import { GRPC_CLIENT_TOKENS, GrpcServiceName } from '@libs/transports';

interface AuthorizerServiceClient {
  getPermissionsForRoles(request: { roles: string[] }): Observable<{ permissions: string[] }>;
}

/**
 * Replaces the old UserPermissionResolver (which called user-access directly over TCP) — same
 * PermissionResolver contract, so PermissionGuard and everything downstream of it needed zero
 * changes. Authorization decisions now live in apps/authorizer, reached over gRPC; this class is
 * just the gRPC client wiring, all the actual roles-to-permissions logic (and its own caching)
 * moved to AuthorizationService in that service.
 */
@Injectable()
export class AuthorizerPermissionResolver implements PermissionResolver, OnModuleInit {
  private authorizerClient!: AuthorizerServiceClient;

  constructor(@Inject(GRPC_CLIENT_TOKENS[GrpcServiceName.AUTHORIZER]) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.authorizerClient = this.client.getService<AuthorizerServiceClient>('AuthorizerService');
  }

  async getPermissionsForRoles(roleNames: string[]): Promise<string[]> {
    const response = await firstValueFrom(this.authorizerClient.getPermissionsForRoles({ roles: roleNames }));
    return response.permissions ?? [];
  }
}
