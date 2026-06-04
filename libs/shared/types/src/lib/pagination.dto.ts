import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT } from '@libs/constants';
import { PaginationMeta } from './api-response.types';

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

@ValidatorConstraint({ name: 'mutuallyExclusivePageCursor', async: false })
export class MutuallyExclusivePageCursor implements ValidatorConstraintInterface {
  validate(value: { cursor?: string; page?: number }): boolean {
    return !(value.cursor && value.page !== undefined);
  }

  defaultMessage(): string {
    return 'Cannot use both `cursor` and `page` in the same request. Use one or the other.';
  }
}

export class PaginationQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_PAGE,
    minimum: 1,
    example: DEFAULT_PAGE,
    description: 'Page number to return. Pages are 1-indexed.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = DEFAULT_PAGE;

  @ApiPropertyOptional({
    default: DEFAULT_LIMIT,
    minimum: 1,
    maximum: MAX_LIMIT,
    example: DEFAULT_LIMIT,
    description: 'Maximum number of records to return.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit = DEFAULT_LIMIT;
}

export class CursorPaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Opaque cursor from a previous response. Pass this to fetch the next page. Omit for the first page.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    default: DEFAULT_LIMIT,
    minimum: 1,
    maximum: MAX_LIMIT,
    example: DEFAULT_LIMIT,
    description: 'Maximum number of records to return.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit = DEFAULT_LIMIT;
}

export class PaginationSortQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Field to sort by' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder, { message: 'sortOrder must be ASC or DESC' })
  @Transform(({ value }) => (value as string)?.toUpperCase())
  sortOrder: SortOrder = SortOrder.DESC;
}

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
