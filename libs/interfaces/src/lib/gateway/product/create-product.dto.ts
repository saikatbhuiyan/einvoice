import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Sanitize } from '@libs/decorators';
import { PRODUCT_CONSTRAINTS, SUPPORTED_CURRENCIES } from './product.types';
import type { CreateProductRequest, SupportedCurrency } from './product.types';

const constraints = PRODUCT_CONSTRAINTS.item;

export class CreateProductDto implements CreateProductRequest {
  @ApiProperty({
    example: 'SKU-SUBSCRIPTION-PRO',
    minLength: constraints.catalogId.minLength,
    maxLength: constraints.catalogId.maxLength,
    description: 'Unique catalog/SKU identifier. This is the value invoice line items reference as catalogId.',
  })
  @Sanitize({ normalizeWhitespace: false })
  @IsString()
  @Length(constraints.catalogId.minLength, constraints.catalogId.maxLength)
  sku!: string;

  @ApiProperty({
    example: 'Enterprise subscription',
    minLength: constraints.name.minLength,
    maxLength: constraints.name.maxLength,
    description: 'Human-readable product name.',
  })
  @Sanitize()
  @IsString()
  @Length(constraints.name.minLength, constraints.name.maxLength)
  name!: string;

  @ApiPropertyOptional({
    example: 'Annual enterprise-tier subscription with priority support.',
    maxLength: 1000,
    description: 'Optional longer description shown to internal catalog consumers.',
  })
  @IsOptional()
  @Sanitize()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({
    example: 15000,
    minimum: constraints.unitPrice.min,
    maximum: constraints.unitPrice.max,
    description: 'Unit price before VAT. Supports up to two decimal places.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: constraints.unitPrice.maxDecimalPlaces })
  @Min(constraints.unitPrice.min)
  @Max(constraints.unitPrice.max)
  unitPrice!: number;

  @ApiProperty({
    enum: SUPPORTED_CURRENCIES,
    enumName: 'SupportedCurrency',
    example: 'BDT',
    description: 'Currency the unit price is denominated in.',
  })
  @IsEnum(SUPPORTED_CURRENCIES)
  currency!: SupportedCurrency;

  @ApiProperty({
    example: 15,
    minimum: constraints.vatRate.min,
    maximum: constraints.vatRate.max,
    description: 'Default VAT percentage applied when this product is added to an invoice.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: constraints.vatRate.maxDecimalPlaces })
  @Min(constraints.vatRate.min)
  @Max(constraints.vatRate.max)
  vatRate!: number;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'Whether the product is available for use. Defaults to true.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
