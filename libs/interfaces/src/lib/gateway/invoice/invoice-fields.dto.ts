import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { INVOICE_CONSTRAINTS, INVOICE_STATUSES, SUPPORTED_CURRENCIES } from '@libs/shared/types';
import type { ClientSnapshotRequest, InvoiceItemRequest, InvoiceStatus, SupportedCurrency } from './invoice.types';

const constraints = INVOICE_CONSTRAINTS;

export class ClientSnapshotDto implements ClientSnapshotRequest {
  @IsString()
  @Length(constraints.client.name.minLength, constraints.client.name.maxLength)
  name!: string;

  @IsEmail()
  @MaxLength(constraints.client.email.maxLength)
  email!: string;

  @IsString()
  @Length(constraints.client.address.minLength, constraints.client.address.maxLength)
  address!: string;
}

export class InvoiceItemDto implements InvoiceItemRequest {
  @IsString()
  @Length(constraints.item.catalogId.minLength, constraints.item.catalogId.maxLength)
  catalogId!: string;

  @IsString()
  @Length(constraints.item.name.minLength, constraints.item.name.maxLength)
  name!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: constraints.item.quantity.maxDecimalPlaces })
  @Min(constraints.item.quantity.min)
  @Max(constraints.item.quantity.max)
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: constraints.item.unitPrice.maxDecimalPlaces })
  @Min(constraints.item.unitPrice.min)
  @Max(constraints.item.unitPrice.max)
  unitPrice!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: constraints.item.vatRate.maxDecimalPlaces })
  @Min(constraints.item.vatRate.min)
  @Max(constraints.item.vatRate.max)
  vatRate!: number;
}

export class InvoiceFieldsDto {
  @IsString()
  @Length(constraints.invoiceNumber.minLength, constraints.invoiceNumber.maxLength)
  invoiceNumber!: string;

  @IsEnum(SUPPORTED_CURRENCIES)
  currency!: SupportedCurrency;

  @IsOptional()
  @IsEnum(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(constraints.notes.maxLength)
  notes?: string;
}
