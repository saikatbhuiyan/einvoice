import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsMongoId,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INVOICE_CONSTRAINTS, SUPPORTED_CURRENCIES } from '@libs/shared/types';
import { Sanitize } from '@libs/decorators';
import type { CreateInvoiceRequest } from './invoice.types';
import { ClientSnapshotDto, InvoiceItemDto } from './invoice-fields.dto';
import type { SupportedCurrency } from './invoice.types';

const constraints = INVOICE_CONSTRAINTS;

@ValidatorConstraint({ name: 'notBothWithClient' })
class NotBothWithClient implements ValidatorConstraintInterface {
  validate(_customerId: unknown, args: ValidationArguments): boolean {
    return (args.object as CreateInvoiceDto).client === undefined;
  }

  defaultMessage(): string {
    return 'give either customerId or client, not both';
  }
}

/**
 * A new draft. Give either `customerId` (the server snapshots that customer's details) or `client`
 * (a one-off client), not both. There is no invoice number: it is assigned when the invoice is
 * issued.
 */
export class CreateInvoiceDto implements CreateInvoiceRequest {
  @ApiPropertyOptional({
    example: '662f9d38f2ab7c001f52c9aa',
    description: 'Customer to invoice; their details are copied onto the invoice. Mutually exclusive with `client`.',
  })
  // Validated when given, and also when *neither* is given -- so "neither" fails with a clear message.
  @ValidateIf((dto: CreateInvoiceDto) => dto.customerId !== undefined || dto.client === undefined)
  @IsMongoId({ message: 'customerId must be a valid id (or give a one-off client instead)' })
  @Validate(NotBothWithClient)
  customerId?: string;

  @ApiPropertyOptional({
    type: () => ClientSnapshotDto,
    description: 'One-off client details, captured as an immutable snapshot. Mutually exclusive with `customerId`.',
  })
  @ValidateIf((dto: CreateInvoiceDto) => dto.client !== undefined)
  @ValidateNested()
  @Type(() => ClientSnapshotDto)
  client?: ClientSnapshotDto;

  @ApiPropertyOptional({
    example: 'PO-4711',
    maxLength: constraints.reference.maxLength,
    description: "The client's own reference (e.g. a purchase-order number).",
  })
  @IsOptional()
  @Sanitize()
  @IsString()
  @MaxLength(constraints.reference.maxLength)
  reference?: string;

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
