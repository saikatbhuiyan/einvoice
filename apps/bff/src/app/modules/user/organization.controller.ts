import { Body, Controller, Get, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateOrganizationDto,
  FindAllOrganizationsDto,
  FindAllOrganizationsResponseDto,
  OrganizationIdGatewayDto,
  OrganizationResponseDto,
} from '@libs/interfaces/gateway';
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
 * Platform administration: organizations (tenants). platform:admin comes from the platform-admin
 * Keycloak realm role and needs no active organization. Never cached: rarely read, and an operator
 * expects to see what they just created.
 */
@ApiTags('Organizations (platform)')
@ApiCorrelationIdHeader()
@ApiBearerAuth('jwt')
@RateLimit({ burst: RATE_LIMIT_DEFAULT_BURST, rate: RATE_LIMIT_DEFAULT_RATE })
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly client: UserClientService) {}

  @Post()
  @RequirePermission('platform:admin')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Organization created successfully')
  @ApiOperation({
    summary: 'Create an organization',
    description:
      'Creates a tenant together with its first administrator: an existing person (by email) is added to it, a new one is created in Keycloak. If adding the administrator fails, the organization is removed again.',
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.CREATED,
    description: 'Organization created.',
    model: OrganizationResponseDto,
    message: 'Organization created successfully',
  })
  @ApiProblemResponses(
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.CONFLICT,
    HttpStatus.FORBIDDEN,
    HttpStatus.BAD_GATEWAY,
  )
  create(@Body() payload: CreateOrganizationDto) {
    return this.client.createOrganization(payload);
  }

  @Get()
  @RequirePermission('platform:admin')
  @ResponseMessage('Organizations retrieved successfully')
  @ApiOperation({ summary: 'List organizations' })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Organizations retrieved.',
    model: FindAllOrganizationsResponseDto,
    message: 'Organizations retrieved successfully',
  })
  findAll(@Query() query: FindAllOrganizationsDto) {
    return this.client.findAllOrganizations(query);
  }

  @Get(':id')
  @RequirePermission('platform:admin')
  @ResponseMessage('Organization retrieved successfully')
  @ApiOperation({ summary: 'Get an organization' })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Organization retrieved.',
    model: OrganizationResponseDto,
    message: 'Organization retrieved successfully',
  })
  @ApiProblemResponses(HttpStatus.NOT_FOUND, HttpStatus.FORBIDDEN, HttpStatus.BAD_GATEWAY)
  findOne(@Param() params: OrganizationIdGatewayDto) {
    return this.client.findOneOrganization(params.id);
  }
}
