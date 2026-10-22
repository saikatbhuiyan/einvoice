import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BIN_PATTERN, INVOICE_CONSTRAINTS, TAX_IDENTITY_CONSTRAINTS } from '@libs/shared/types';
import { Sanitize } from '@libs/decorators';
import type { ClientSnapshotRequest, InvoiceItemRequest } from './invoice.types';

const constraints = INVOICE_CONSTRAINTS;

/** Fields a catalog-backed line takes from the product, so it must not send them. */
const CATALOG_FIELDS = ['catalogId', 'name', 'unitPrice', 'vatRate', 'sdRate', 'unit'] as const;

/** Re-checked in the invoice service: RPC payloads skip DTO validation. */
@ValidatorConstraint({ name: 'catalogLine' })
class CatalogLineConstraint implements ValidatorConstraintInterface {
  validate(_productId: unknown, args: ValidationArguments): boolean {
    const line = args.object as Record<string, unknown>;
    return CATALOG_FIELDS.every((field) => line[field] === undefined);
  }

  defaultMessage(): string {
    return `A catalog line (productId) takes its ${CATALOG_FIELDS.join(', ')} from the product; send only productId and quantity, or a free-form line without productId.`;
  }
}

/** Free-form lines need the field; catalog lines must not send it (checked on productId). */
const freeForm = (line: { productId?: string }) => line.productId === undefined;

export class ClientSnapshotDto implements ClientSnapshotRequest {
  @ApiProperty({
    example: 'Acme Bangladesh Ltd.',
    minLength: constraints.client.name.minLength,
    maxLength: constraints.client.name.maxLength,
    description: 'Legal or trading name captured on the invoice.',
  })
  @Sanitize()
  @IsString()
  @Length(constraints.client.name.minLength, constraints.client.name.maxLength)
  name!: string;

  @ApiProperty({
    example: 'finance@acme.example',
    maxLength: constraints.client.email.maxLength,
    format: 'email',
    description: 'Billing contact email for the client snapshot.',
  })
  @Sanitize({ stripHtml: true, normalizeWhitespace: false })
  @IsEmail()
  @MaxLength(constraints.client.email.maxLength)
  email!: string;

  @ApiProperty({
    example: 'House 12, Road 8, Gulshan, Dhaka 1212',
    minLength: constraints.client.address.minLength,
    maxLength: constraints.client.address.maxLength,
    description: 'Billing address captured at invoice creation time.',
  })
  @Sanitize()
  @IsString()
  @Length(constraints.client.address.minLength, constraints.client.address.maxLength)
  address!: string;

  @ApiPropertyOptional({
    example: '+880 1711-111111',
    maxLength: 20,
    description: 'Billing contact phone. Payment gateways that ask for one (SSLCommerz) receive it.',
  })
  @IsOptional()
  @Sanitize()
  @MaxLength(20)
  @Matches(INVOICE_CONSTRAINTS.client.phone.pattern, { message: 'phone must be a phone number, e.g. +880 1711-111111' })
  phone?: string;

  @ApiPropertyOptional({
    example: '0098765430202',
    pattern: '^\\d{13}$',
    description:
      'Bangladesh BIN of a registered buyer (13 digits): "BIN of Purchaser" on a Mushak-6.3. Omit for an unregistered buyer.',
  })
  @IsOptional()
  @Matches(BIN_PATTERN, { message: 'bin must be exactly 13 digits' })
  bin?: string;
}

export class InvoiceItemDto implements InvoiceItemRequest {
  @ApiPropertyOptional({
    example: '5f1d7c1e-2b9a-4c64-9a7e-3f1c2d4b5a6e',
    format: 'uuid',
    description:
      "A product in the organization's catalog: the line then takes its name, SKU, price, VAT and SD rates from the product (send only productId and quantity). Omit for a free-form line.",
  })
  @IsOptional()
  @IsUUID()
  @Validate(CatalogLineConstraint)
  productId?: string;

  @ApiPropertyOptional({
    example: 'SKU-SUBSCRIPTION-PRO',
    minLength: constraints.item.catalogId.minLength,
    maxLength: constraints.item.catalogId.maxLength,
    description: 'Free-form lines: catalog, SKU, or product identifier from the source system.',
  })
  @ValidateIf(freeForm)
  @Sanitize({ normalizeWhitespace: false })
  @IsString()
  @Length(constraints.item.catalogId.minLength, constraints.item.catalogId.maxLength)
  catalogId?: string;

  @ApiPropertyOptional({
    example: 'Enterprise subscription',
    minLength: constraints.item.name.minLength,
    maxLength: constraints.item.name.maxLength,
    description: 'Free-form lines: human-readable line item name.',
  })
  @ValidateIf(freeForm)
  @Sanitize()
  @IsString()
  @Length(constraints.item.name.minLength, constraints.item.name.maxLength)
  name?: string;

  @ApiProperty({
    example: 2,
    minimum: constraints.item.quantity.min,
    maximum: constraints.item.quantity.max,
    description: 'Line item quantity. Supports up to two decimal places.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: constraints.item.quantity.maxDecimalPlaces })
  @Min(constraints.item.quantity.min)
  @Max(constraints.item.quantity.max)
  quantity!: number;

  @ApiPropertyOptional({
    example: 15000,
    minimum: constraints.item.unitPrice.min,
    maximum: constraints.item.unitPrice.max,
    description:
      "Free-form lines: unit price before SD and VAT, in the invoice currency, with at most the currency's decimal places (2 for BDT, USD, EUR, GBP).",
  })
  @ValidateIf(freeForm)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: constraints.item.unitPrice.maxDecimalPlaces })
  @Min(constraints.item.unitPrice.min)
  @Max(constraints.item.unitPrice.max)
  unitPrice?: number;

  @ApiPropertyOptional({
    example: 15,
    minimum: constraints.item.vatRate.min,
    maximum: constraints.item.vatRate.max,
    description: 'Free-form lines: VAT percentage, charged on net + SD.',
  })
  @ValidateIf(freeForm)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: constraints.item.vatRate.maxDecimalPlaces })
  @Min(constraints.item.vatRate.min)
  @Max(constraints.item.vatRate.max)
  vatRate?: number;

  @ApiPropertyOptional({
    example: 0,
    default: 0,
    minimum: constraints.item.sdRate.min,
    maximum: constraints.item.sdRate.max,
    description:
      'Free-form lines: Bangladesh supplementary duty percentage (VAT is charged on net + SD). Omit elsewhere.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: constraints.item.sdRate.maxDecimalPlaces })
  @Min(constraints.item.sdRate.min)
  @Max(constraints.item.sdRate.max)
  sdRate?: number;

  @ApiPropertyOptional({
    example: 'pcs',
    maxLength: TAX_IDENTITY_CONSTRAINTS.unit.maxLength,
    description: 'Free-form lines: unit of supply ("pcs", "kg", "service"). Catalog lines take the product\'s.',
  })
  @IsOptional()
  @Sanitize()
  @IsString()
  @Length(1, TAX_IDENTITY_CONSTRAINTS.unit.maxLength)
  unit?: string;
}
