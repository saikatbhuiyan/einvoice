import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '@libs/shared/types';
import type { FindAllProductsRequest } from './product.types';

export class FindAllProductsDto extends PaginationQueryDto implements FindAllProductsRequest {
  @ApiPropertyOptional({
    example: 'subscription',
    description: 'Free-text search against product SKU and name.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Filter by active status.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() === 'true' : value))
  @IsBoolean()
  isActive?: boolean;
}
