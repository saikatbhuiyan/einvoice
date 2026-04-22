import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@libs/shared/types';
import { INVOICE_STATUSES, SUPPORTED_CURRENCIES } from '@libs/schemas';

export class FindAllInvoicesDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(INVOICE_STATUSES)
  status?: (typeof INVOICE_STATUSES)[number];

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsEnum(SUPPORTED_CURRENCIES)
  currency?: (typeof SUPPORTED_CURRENCIES)[number];

  @IsOptional()
  @IsEmail()
  clientEmail?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
