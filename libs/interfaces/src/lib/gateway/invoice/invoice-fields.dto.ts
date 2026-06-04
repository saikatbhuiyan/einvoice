import { Type } from 'class-transformer';
import { IsEmail, IsNumber, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { INVOICE_CONSTRAINTS } from '@libs/shared/types';
import { Sanitize } from '@libs/decorators';
import type { ClientSnapshotRequest, InvoiceItemRequest } from './invoice.types';

const constraints = INVOICE_CONSTRAINTS;

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
}

export class InvoiceItemDto implements InvoiceItemRequest {
  @ApiProperty({
    example: 'SKU-SUBSCRIPTION-PRO',
    minLength: constraints.item.catalogId.minLength,
    maxLength: constraints.item.catalogId.maxLength,
    description: 'Catalog, SKU, or product identifier from the source system.',
  })
  @Sanitize({ normalizeWhitespace: false })
  @IsString()
  @Length(constraints.item.catalogId.minLength, constraints.item.catalogId.maxLength)
  catalogId!: string;

  @ApiProperty({
    example: 'Enterprise subscription',
    minLength: constraints.item.name.minLength,
    maxLength: constraints.item.name.maxLength,
    description: 'Human-readable line item name.',
  })
  @Sanitize()
  @IsString()
  @Length(constraints.item.name.minLength, constraints.item.name.maxLength)
  name!: string;

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

  @ApiProperty({
    example: 15000,
    minimum: constraints.item.unitPrice.min,
    maximum: constraints.item.unitPrice.max,
    description: 'Unit price before VAT. Supports up to two decimal places.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: constraints.item.unitPrice.maxDecimalPlaces })
  @Min(constraints.item.unitPrice.min)
  @Max(constraints.item.unitPrice.max)
  unitPrice!: number;

  @ApiProperty({
    example: 15,
    minimum: constraints.item.vatRate.min,
    maximum: constraints.item.vatRate.max,
    description: 'VAT percentage applied to this line item.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: constraints.item.vatRate.maxDecimalPlaces })
  @Min(constraints.item.vatRate.min)
  @Max(constraints.item.vatRate.max)
  vatRate!: number;
}
