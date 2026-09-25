import { Injectable } from '@nestjs/common';
import type { PermissionResolver } from '@libs/auth';
import { UserService } from '../user/user.service';

@Injectable()
export class UserPermissionResolver implements PermissionResolver {
  constructor(private readonly userService: UserService) {}

  async getPermissionsForRoles(roleNames: string[]): Promise<string[]> {
    // findAllRoles() is already 60s-TTL cached in UserService, so this is a cheap in-process
    // lookup on the common path, not a fresh RPC call to user-access per guarded request.
    const { items } = await this.userService.findAllRoles();
    const roleNameSet = new Set(roleNames);
    const permissions = items.filter((role) => roleNameSet.has(role.name)).flatMap((role) => role.permissions);
    return Array.from(new Set(permissions));
  }
}
