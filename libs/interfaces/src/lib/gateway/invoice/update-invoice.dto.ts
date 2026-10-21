import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { INVOICE_CONSTRAINTS, SUPPORTED_CURRENCIES } from '@libs/shared/types';
import { Sanitize } from '@libs/decorators';
import type { UpdateClientSnapshotRequest, UpdateInvoiceItemRequest, UpdateInvoiceRequest } from './invoice.types';
import { ClientSnapshotDto, InvoiceItemDto } from './invoice-fields.dto';
import type { SupportedCurrency } from './invoice.types';

const constraints = INVOICE_CONSTRAINTS;

export class UpdateClientSnapshotDto extends PartialType(ClientSnapshotDto) implements UpdateClientSnapshotRequest {}

/** Items on update replace the whole list, so each is a complete line, as on create. */
export class UpdateInvoiceItemDto extends InvoiceItemDto implements UpdateInvoiceItemRequest {}

export class UpdateInvoiceDto implements UpdateInvoiceRequest {
  @ApiPropertyOptional({
    example: 'PO-4711',
    maxLength: constraints.reference.maxLength,
    description:
      "The client's own reference (e.g. a purchase-order number). The invoice number itself is assigned on issue.",
  })
  @IsOptional()
  @Sanitize()
  @IsString()
  @MaxLength(constraints.reference.maxLength)
  reference?: string;

  @ApiPropertyOptional({
    type: () => UpdateClientSnapshotDto,
    description: 'Partial client snapshot update.',
  })
  @ValidateNested()
  @Type(() => UpdateClientSnapshotDto)
  @IsOptional()
  client?: UpdateClientSnapshotDto;

  @ApiPropertyOptional({
    type: () => UpdateInvoiceItemDto,
    isArray: true,
    minItems: 1,
    description: 'Replaces all line items; each is a complete line (catalog-backed or free-form), as on create.',
  })
  @IsArray()
  @ArrayMinSize(INVOICE_CONSTRAINTS.items.minItems)
  @ArrayMaxSize(INVOICE_CONSTRAINTS.items.maxItems)
  @ValidateNested({ each: true })
  @Type(() => UpdateInvoiceItemDto)
  @IsOptional()
  items?: UpdateInvoiceItemDto[];

  @ApiPropertyOptional({
    enum: SUPPORTED_CURRENCIES,
    enumName: 'SupportedCurrency',
    example: 'BDT',
    description: 'Currency used for all monetary amounts on the invoice.',
  })
  @IsOptional()
  @IsEnum(SUPPORTED_CURRENCIES)
  currency?: SupportedCurrency;

  @ApiPropertyOptional({
    example: '2026-04-28',
    format: 'date',
    description: 'Date the invoice is issued.',
  })
  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @ApiPropertyOptional({
    example: '2026-05-28',
    format: 'date',
    description: 'Payment due date for the invoice.',
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({
    example: 'Payment due within 30 days.',
    maxLength: constraints.notes.maxLength,
    description: 'Optional notes shown to the client.',
  })
  @IsOptional()
  @Sanitize()
  @IsString()
  @MaxLength(constraints.notes.maxLength)
  notes?: string;
}
