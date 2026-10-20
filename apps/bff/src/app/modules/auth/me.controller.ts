import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '@libs/auth';
import { CurrentCallerResponseDto, type CurrentCallerResponse } from '@libs/interfaces/gateway';
import { ResponseMessage } from '@libs/interceptors';
import { ORGANIZATION_HEADER } from '@libs/shared/types';
import { ApiCorrelationIdHeader, ApiEnvelopeResponse } from '../../common/swagger/api-response.decorator';

@ApiTags('Auth')
@ApiCorrelationIdHeader()
@ApiBearerAuth('jwt')
@Controller('me')
export class MeController {
  // Authenticated, but no @RequirePermission: a member of several organizations has to be able to
  // ask where they belong *before* choosing one. PermissionGuard has already resolved all of this.
  @Get()
  @ResponseMessage('Caller retrieved successfully')
  @ApiOperation({
    summary: 'Who am I',
    description: `Your identity, every organization you belong to (with your role there), and -- if this request resolved to one (the ${ORGANIZATION_HEADER} header, or your only organization) -- the active organization and your permissions in it.`,
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'The caller.',
    model: CurrentCallerResponseDto,
    message: 'Caller retrieved successfully',
  })
  me(@CurrentUser() user: AuthenticatedUser): CurrentCallerResponse {
    return {
      userId: user.sub,
      username: user.username,
      email: user.email,
      activeOrganizationId: user.organizationId,
      memberships: user.memberships ?? [],
      permissions: user.permissions ?? [],
    };
  }
}
