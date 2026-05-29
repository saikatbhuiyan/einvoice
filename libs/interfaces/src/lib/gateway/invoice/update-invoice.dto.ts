import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsArray,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { INVOICE_CONSTRAINTS, INVOICE_STATUSES, SUPPORTED_CURRENCIES } from '@libs/shared/types';
import { Sanitize } from '@libs/decorators';
import type { UpdateClientSnapshotRequest, UpdateInvoiceItemRequest, UpdateInvoiceRequest } from './invoice.types';
import { ClientSnapshotDto, InvoiceItemDto } from './invoice-fields.dto';
import type { InvoiceStatus, SupportedCurrency } from './invoice.types';

const constraints = INVOICE_CONSTRAINTS;

export class UpdateClientSnapshotDto extends PartialType(ClientSnapshotDto) implements UpdateClientSnapshotRequest {}

export class UpdateInvoiceItemDto extends PartialType(InvoiceItemDto) implements UpdateInvoiceItemRequest {}

export class UpdateInvoiceDto implements UpdateInvoiceRequest {
  @ApiPropertyOptional({
    example: 'INV-2026-0001',
    minLength: constraints.invoiceNumber.minLength,
    maxLength: constraints.invoiceNumber.maxLength,
    description: 'External invoice number. Must be unique in the invoice service.',
  })
  @IsOptional()
  @Sanitize({ normalizeWhitespace: false })
  @IsString()
  @Length(constraints.invoiceNumber.minLength, constraints.invoiceNumber.maxLength)
  invoiceNumber?: string;

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
    description: 'Replace invoice line items with the provided partial item set.',
  })
  @IsArray()
  @ArrayMinSize(1)
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
    enum: INVOICE_STATUSES,
    enumName: 'InvoiceStatus',
    example: 'issued',
    description: 'Lifecycle status.',
  })
  @IsOptional()
  @IsEnum(INVOICE_STATUSES)
  status?: InvoiceStatus;

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
