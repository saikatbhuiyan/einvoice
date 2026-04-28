import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { INVOICE_STATUSES, PaginationQueryDto, SUPPORTED_CURRENCIES } from '@libs/shared/types';
import type { FindAllInvoicesRequest, InvoiceStatus, SupportedCurrency } from './invoice.types';

export class FindAllInvoicesDto extends PaginationQueryDto implements FindAllInvoicesRequest {
  @IsOptional()
  @IsEnum(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsEnum(SUPPORTED_CURRENCIES)
  currency?: SupportedCurrency;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  clientEmail?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  search?: string;
}
