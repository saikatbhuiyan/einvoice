import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { Public } from '@libs/auth/public.decorator';
import { RoleService } from './role.service';

interface GrpcRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isActive: boolean;
}

// Authorizer's gRPC client to this service — general-purpose role data, the same information
// ROLE.FIND_ALL already exposes over TCP to bff, just reachable over gRPC for Authorizer too.
// RpcPermissionGuard is registered globally and runs for every microservice transport (Nest
// reports 'rpc' for gRPC contexts too, not just TCP), so without @Public() this call would be
// rejected as unauthenticated — it never carries a TCP RpcEnvelope, since Authorizer resolves
// permissions for arbitrary role names on a service-to-service call, not on behalf of a specific
// already-authenticated end user. Trust here is the same network-boundary argument ROLE.FIND_ALL's
// TCP handler already makes for bff ("this port should only ever be reachable by its one intended
// caller"), applied to Authorizer instead — and it's a firmer case here, since @RequirePermission
// on this handler would still have the same "can't require a permission it doesn't have yet"
// circularity even if identity were present.
@Controller()
export class RoleGrpcController {
  constructor(private readonly roleService: RoleService) {}

  @Public()
  @GrpcMethod('RoleQueryService', 'FindAllRoles')
  async findAllRoles(): Promise<{ roles: GrpcRole[] }> {
    const { items } = await this.roleService.findAll();
    return {
      roles: items.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description ?? '',
        permissions: role.permissions,
        isActive: role.isActive,
      })),
    };
  }
}
