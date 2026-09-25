import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto, SUPPORTED_CURRENCIES } from '@libs/shared/types';
import type { FindAllProductsResponse, ProductResponse, SupportedCurrency } from './product.types';

export class ProductResponseDto implements ProductResponse {
  @ApiProperty({
    example: '3f1b3c9a-7e3d-4a2c-9c1e-6b1a4a9c2f10',
    description: 'Product identifier (UUID).',
  })
  id!: string;

  @ApiProperty({ example: 'SKU-SUBSCRIPTION-PRO' })
  sku!: string;

  @ApiProperty({ example: 'Enterprise subscription' })
  name!: string;

  @ApiPropertyOptional({ example: 'Annual enterprise-tier subscription with priority support.' })
  description?: string;

  @ApiProperty({ example: 15000 })
  unitPrice!: number;

  @ApiProperty({ enum: SUPPORTED_CURRENCIES, enumName: 'SupportedCurrency', example: 'BDT' })
  currency!: SupportedCurrency;

  @ApiProperty({ example: 15 })
  vatRate!: number;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-04-28T10:30:00.000Z', format: 'date-time' })
  createdAt!: string | Date;

  @ApiProperty({ example: '2026-04-28T10:30:00.000Z', format: 'date-time' })
  updatedAt!: string | Date;
}

export class FindAllProductsResponseDto implements FindAllProductsResponse {
  @ApiProperty({ type: () => ProductResponseDto, isArray: true })
  items!: ProductResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta!: PaginationMetaDto;
}
