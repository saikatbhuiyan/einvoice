import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBody, ApiExtraModels, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  CreateUserDto,
  DeactivateUserResponseDto,
  FindAllRolesResponseDto,
  FindAllUsersDto,
  FindAllUsersResponseDto,
  UpdateUserDto,
  UserResponseDto,
} from '@libs/interfaces/gateway';
import { ResponseMessage } from '@libs/interceptors';
import { RateLimit } from '@libs/rate-limit';
import {
  RATE_LIMIT_DEFAULT_BURST,
  RATE_LIMIT_DEFAULT_RATE,
  RATE_LIMIT_DELETE_BURST,
  RATE_LIMIT_DELETE_RATE,
  RATE_LIMIT_MUTATE_BURST,
  RATE_LIMIT_MUTATE_RATE,
} from '@libs/constants';
import {
  ApiCorrelationIdHeader,
  ApiEnvelopeResponse,
  ApiProblemResponses,
} from '../../common/swagger/api-response.decorator';
import {
  CREATE_USER_EXAMPLE,
  FIND_ALL_ROLES_RESPONSE_EXAMPLE,
  FIND_ALL_USERS_RESPONSE_EXAMPLE,
  USER_ID_EXAMPLE,
  USER_RESPONSE_EXAMPLE,
} from './user.examples';
import { UserService } from './user.service';

@ApiTags('Users')
@ApiCorrelationIdHeader()
@RateLimit({ burst: RATE_LIMIT_DEFAULT_BURST, rate: RATE_LIMIT_DEFAULT_RATE })
@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('roles')
  @ResponseMessage('Roles retrieved successfully')
  @ApiOperation({
    summary: 'List roles',
    description: 'Returns the available roles a user can be assigned. Roles are managed via seed data, not this API.',
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Roles retrieved.',
    model: FindAllRolesResponseDto,
    message: 'Roles retrieved successfully',
    dataExample: FIND_ALL_ROLES_RESPONSE_EXAMPLE,
  })
  findAllRoles() {
    return this.userService.findAllRoles();
  }

  @Post('users')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('User created successfully')
  @ApiOperation({
    summary: 'Create user',
    description: 'Creates a user and assigns it an existing role.',
  })
  @ApiBody({
    type: CreateUserDto,
    examples: { user: { summary: 'Accountant user', value: CREATE_USER_EXAMPLE } },
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.CREATED,
    description: 'User created.',
    model: UserResponseDto,
    message: 'User created successfully',
    dataExample: USER_RESPONSE_EXAMPLE,
  })
  @ApiProblemResponses(
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.BAD_GATEWAY,
  )
  create(@Body() payload: CreateUserDto) {
    return this.userService.create(payload);
  }

  @Get('users')
  @ResponseMessage('Users retrieved successfully')
  @ApiOperation({
    summary: 'List users',
    description:
      'Returns users with offset pagination, optional free-text search, role filter, and active-status filter.',
  })
  @ApiExtraModels(FindAllUsersResponseDto)
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Users retrieved.',
    model: UserResponseDto,
    message: 'Users retrieved successfully',
    dataExample: FIND_ALL_USERS_RESPONSE_EXAMPLE,
    isArray: true,
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.BAD_GATEWAY, HttpStatus.SERVICE_UNAVAILABLE)
  findAll(@Query() query: FindAllUsersDto, @Res({ passthrough: true }) res: Response) {
    return this.userService.findAll(query, res);
  }

  @Get('users/:id')
  @ResponseMessage('User retrieved successfully')
  @ApiOperation({ summary: 'Get user', description: 'Returns a single user by id.' })
  @ApiParam({ name: 'id', example: USER_ID_EXAMPLE })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'User retrieved.',
    model: UserResponseDto,
    message: 'User retrieved successfully',
    dataExample: USER_RESPONSE_EXAMPLE,
  })
  @ApiProblemResponses(HttpStatus.NOT_FOUND, HttpStatus.BAD_GATEWAY)
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch('users/:id')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('User updated successfully')
  @ApiOperation({
    summary: 'Update user',
    description: 'Applies a partial update to a user, including reassigning its role.',
  })
  @ApiParam({ name: 'id', example: USER_ID_EXAMPLE })
  @ApiBody({ type: UpdateUserDto })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'User updated.',
    model: UserResponseDto,
    message: 'User updated successfully',
    dataExample: USER_RESPONSE_EXAMPLE,
  })
  @ApiProblemResponses(
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.BAD_GATEWAY,
  )
  update(@Param('id') id: string, @Body() payload: UpdateUserDto) {
    return this.userService.update(id, payload);
  }

  @Delete('users/:id')
  @RateLimit({ burst: RATE_LIMIT_DELETE_BURST, rate: RATE_LIMIT_DELETE_RATE })
  @ResponseMessage('User deactivated successfully')
  @ApiOperation({
    summary: 'Deactivate user',
    description: 'Soft-deactivates a user (sets isActive to false); does not delete the record.',
  })
  @ApiParam({ name: 'id', example: USER_ID_EXAMPLE })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'User deactivated.',
    model: DeactivateUserResponseDto,
    message: 'User deactivated successfully',
    dataExample: { id: USER_ID_EXAMPLE, deactivated: true },
  })
  @ApiProblemResponses(HttpStatus.NOT_FOUND, HttpStatus.BAD_GATEWAY)
  deactivate(@Param('id') id: string) {
    return this.userService.deactivate(id);
  }
}
