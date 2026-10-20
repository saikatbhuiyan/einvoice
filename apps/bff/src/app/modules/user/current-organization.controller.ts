import { Body, Controller, Get, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationResponseDto, UpdateCurrentOrganizationDto } from '@libs/interfaces/gateway';
import { ResponseMessage } from '@libs/interceptors';
import { RateLimit } from '@libs/rate-limit';
import { RequirePermission } from '@libs/auth';
import {
  RATE_LIMIT_DEFAULT_BURST,
  RATE_LIMIT_DEFAULT_RATE,
  RATE_LIMIT_MUTATE_BURST,
  RATE_LIMIT_MUTATE_RATE,
} from '@libs/constants';
import {
  ApiCorrelationIdHeader,
  ApiEnvelopeResponse,
  ApiProblemResponses,
} from '../../common/swagger/api-response.decorator';
import { UserClientService } from './user-client.service';

/**
 * The active organization's own settings, for its members (singular `/organization`; platform
 * operators manage every organization at `/organizations`). Which organization is decided per request
 * by X-Organization-Id / the caller's memberships, never by an id in the URL.
 */
@ApiTags('Organization (active)')
@ApiCorrelationIdHeader()
@ApiBearerAuth('jwt')
@RateLimit({ burst: RATE_LIMIT_DEFAULT_BURST, rate: RATE_LIMIT_DEFAULT_RATE })
@Controller('organization')
export class CurrentOrganizationController {
  constructor(private readonly client: UserClientService) {}

  @Get()
  @RequirePermission('organization:read')
  @ResponseMessage('Organization retrieved successfully')
  @ApiOperation({ summary: 'Get the active organization', description: 'Including its payment reminder schedule.' })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Organization retrieved.',
    model: OrganizationResponseDto,
    message: 'Organization retrieved successfully',
  })
  @ApiProblemResponses(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.BAD_GATEWAY)
  find() {
    return this.client.findCurrentOrganization();
  }

  @Patch()
  @RequirePermission('organization:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Organization updated successfully')
  @ApiOperation({
    summary: 'Update the active organization',
    description:
      "Its name, invoice prefix and payment reminder schedule (days after the due date; [] turns reminders off). Organization admins only. Changes reach invoice numbering and reminders within a minute (cached settings); a schedule change applies from each invoice's next reminder.",
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Organization updated.',
    model: OrganizationResponseDto,
    message: 'Organization updated successfully',
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.FORBIDDEN, HttpStatus.BAD_GATEWAY)
  update(@Body() payload: UpdateCurrentOrganizationDto) {
    return this.client.updateCurrentOrganization(payload);
  }
}
