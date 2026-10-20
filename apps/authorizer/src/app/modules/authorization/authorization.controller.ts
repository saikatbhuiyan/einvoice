import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { AuthorizationService } from './authorization.service';
import { ResolveCallerRequest, ResolveCallerResponse } from './grpc-contracts';

@Controller()
export class AuthorizationController {
  constructor(private readonly authorizationService: AuthorizationService) {}

  @GrpcMethod('AuthorizerService', 'ResolveCaller')
  resolveCaller(data: Partial<ResolveCallerRequest>): Promise<ResolveCallerResponse> {
    // proto3 delivers absent fields as defaults ("" / []) with this repo's loader options, but be
    // explicit: a missing field means "none", never undefined.
    return this.authorizationService.resolveCaller({
      userId: data.userId ?? '',
      roles: data.roles ?? [],
      organizationId: data.organizationId ?? '',
    });
  }
}
