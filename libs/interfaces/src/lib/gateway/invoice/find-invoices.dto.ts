import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { INVOICE_STATUSES, PaginationQueryDto, SUPPORTED_CURRENCIES } from '@libs/shared/types';
import type { FindAllInvoicesRequest, InvoiceStatus, SupportedCurrency } from './invoice.types';

@ValidatorConstraint({ name: 'mutuallyExclusivePageCursor', async: false })
export class MutuallyExclusivePageCursor implements ValidatorConstraintInterface {
  validate(value: string | undefined, args: object): boolean {
    const dto = (args as { object: FindAllInvoicesRequest }).object;
    return !(dto.cursor && dto.page !== undefined);
  }

  defaultMessage(): string {
    return 'Cannot use both `cursor` and `page` in the same request. Use one or the other.';
  }
}

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

  @ApiPropertyOptional({
    description:
      'Opaque cursor from a previous response. Use instead of page for stable, efficient pagination. Cannot be used together with page.',
  })
  @IsOptional()
  @IsString()
  @Validate(MutuallyExclusivePageCursor)
  cursor?: string;
}
