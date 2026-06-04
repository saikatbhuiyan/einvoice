import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INVOICE_CONSTRAINTS, INVOICE_STATUSES, SUPPORTED_CURRENCIES } from '@libs/shared/types';
import { Sanitize } from '@libs/decorators';
import type { CreateInvoiceRequest } from './invoice.types';
import { ClientSnapshotDto, InvoiceItemDto } from './invoice-fields.dto';
import type { InvoiceStatus, SupportedCurrency } from './invoice.types';

const constraints = INVOICE_CONSTRAINTS;

export class CreateInvoiceDto implements CreateInvoiceRequest {
  @ApiProperty({
    example: 'INV-2026-0001',
    minLength: constraints.invoiceNumber.minLength,
    maxLength: constraints.invoiceNumber.maxLength,
    description: 'External invoice number. Must be unique in the invoice service.',
  })
  @Sanitize({ normalizeWhitespace: false })
  @IsString()
  @Length(constraints.invoiceNumber.minLength, constraints.invoiceNumber.maxLength)
  invoiceNumber!: string;

  @ApiProperty({
    type: () => ClientSnapshotDto,
    description: 'Client details captured as an immutable invoice snapshot.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => ClientSnapshotDto)
  client!: ClientSnapshotDto;

  @ApiProperty({
    type: () => InvoiceItemDto,
    isArray: true,
    minItems: 1,
    description: 'One or more billable invoice line items.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items!: InvoiceItemDto[];

  @ApiProperty({
    enum: SUPPORTED_CURRENCIES,
    enumName: 'SupportedCurrency',
    example: 'BDT',
    description: 'Currency used for all monetary amounts on the invoice.',
  })
  @IsEnum(SUPPORTED_CURRENCIES)
  currency!: SupportedCurrency;

  @ApiPropertyOptional({
    enum: INVOICE_STATUSES,
    enumName: 'InvoiceStatus',
    example: 'issued',
    description: 'Lifecycle status. Omit to let the invoice service apply its default.',
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

  @ApiPropertyOptional({
    example: 'idempotency-key-uuid-v4',
    description:
      'Client-generated idempotency key. If an invoice with this key already exists, the existing invoice is returned instead of creating a duplicate.',
  })
  @IsOptional()
  @Sanitize({ normalizeWhitespace: false })
  @IsString()
  idempotencyKey?: string;
}
