import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '@libs/shared/types';
import type { FindAllUsersRequest } from './user.types';

export class FindAllUsersDto extends PaginationQueryDto implements FindAllUsersRequest {
  @ApiPropertyOptional({ example: 'jane', description: 'Free-text search against user name and email.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: '9b6b3f2a-1c1e-4b9a-8f2e-2a6e2f9c9a10', description: 'Filter by role id.' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ example: true, description: 'Filter by active status.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() === 'true' : value))
  @IsBoolean()
  isActive?: boolean;
}
