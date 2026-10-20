import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Sanitize } from '@libs/decorators';
import type { FindAllOrganizationsRequest, OrganizationIdGatewayRequest } from './organization.types';

export class FindAllOrganizationsDto implements FindAllOrganizationsRequest {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 'acme', description: 'Matches name or slug, case-insensitively.' })
  @IsOptional()
  @Sanitize()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class OrganizationIdGatewayDto implements OrganizationIdGatewayRequest {
  @ApiProperty({ example: '6a1f1c2e-0b9d-4d55-9a8b-6b8f7c1d2e3f' })
  @IsUUID()
  id!: string;
}
