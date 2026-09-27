import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { TCP_PATTERNS } from '@libs/transports';
import { RoleService } from './role.service';

@Controller()
export class RoleRpcController {
  constructor(private readonly roleService: RoleService) {}

  // Deliberately no @RequirePermission('role:read') here, unlike every other handler in this
  // service — bff's own PermissionGuard calls this RPC pattern (via UserPermissionResolver) to
  // resolve *which* permissions a caller has in the first place, before those permissions exist
  // anywhere to check. Gating this on role:read would make that resolution call require a
  // permission it can't possibly have yet — nobody could ever be granted any permission. The
  // baseline RpcPermissionGuard check (a valid identity must be present at all) still applies;
  // the real user-facing authorization decision belongs at bff's GET /roles, which already
  // requires role:read using permissions resolved through this same call.
  @MessagePattern(TCP_PATTERNS.ROLE.FIND_ALL)
  findAllByMessage() {
    return this.roleService.findAll();
  }
}
