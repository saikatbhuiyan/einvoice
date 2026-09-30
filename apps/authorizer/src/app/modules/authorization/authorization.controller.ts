import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { AuthorizationService } from './authorization.service';
import { GetPermissionsForRolesRequest, GetPermissionsForRolesResponse } from './grpc-contracts';

@Controller()
export class AuthorizationController {
  constructor(private readonly authorizationService: AuthorizationService) {}

  @GrpcMethod('AuthorizerService', 'GetPermissionsForRoles')
  async getPermissionsForRoles(data: GetPermissionsForRolesRequest): Promise<GetPermissionsForRolesResponse> {
    const permissions = await this.authorizationService.getPermissionsForRoles(data.roles ?? []);
    return { permissions };
  }
}
