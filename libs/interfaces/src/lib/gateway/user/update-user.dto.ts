import { IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Sanitize } from '@libs/decorators';
import type { UpdateUserRequest } from './user.types';

/**
 * Updates a member of the caller's organization. `roleId` and `isActive` apply to the membership
 * (this organization only); `name` to the person. Email isn't editable here: it's the login
 * identity, and the same person may belong to other organizations.
 */
export class UpdateUserDto implements UpdateUserRequest {
  @ApiPropertyOptional({ example: 'Jane Doe', minLength: 1, maxLength: 160 })
  @IsOptional()
  @Sanitize()
  @IsString()
  @Length(1, 160)
  name?: string;

  @ApiPropertyOptional({
    example: '9b6b3f2a-1c1e-4b9a-8f2e-2a6e2f9c9a10',
    description: "Id of an organization role -- the member's role in this organization.",
  })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
