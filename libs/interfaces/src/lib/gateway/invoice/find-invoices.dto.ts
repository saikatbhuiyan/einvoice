import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { INVOICE_STATUSES, PaginationQueryDto, SUPPORTED_CURRENCIES } from '@libs/shared/types';
import type { FindAllInvoicesRequest, InvoiceStatus, SupportedCurrency } from './invoice.types';

export class FindAllInvoicesDto extends PaginationQueryDto implements FindAllInvoicesRequest {
  @ApiPropertyOptional({
    enum: INVOICE_STATUSES,
    enumName: 'InvoiceStatus',
    example: 'issued',
    description: 'Filter invoices by lifecycle status.',
  })
  @IsOptional()
  @IsEnum(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @ApiPropertyOptional({
    enum: SUPPORTED_CURRENCIES,
    enumName: 'SupportedCurrency',
    example: 'BDT',
    description: 'Filter invoices by currency.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsEnum(SUPPORTED_CURRENCIES)
  currency?: SupportedCurrency;

  @ApiPropertyOptional({
    example: 'finance@acme.example',
    format: 'email',
    description: 'Filter invoices by client billing email.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  clientEmail?: string;

  @ApiPropertyOptional({
    example: 'subscription',
    description: 'Free-text search term applied by the invoice service.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  search?: string;
}
