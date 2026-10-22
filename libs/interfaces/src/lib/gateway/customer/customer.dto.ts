import { OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsMongoId, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BIN_PATTERN, INVOICE_CONSTRAINTS, PaginationMetaDto } from '@libs/shared/types';
import { Sanitize } from '@libs/decorators';
import type {
  CreateCustomerRequest,
  CustomerIdGatewayRequest,
  CustomerResponse,
  DeleteCustomerResponse,
  FindAllCustomersRequest,
  FindAllCustomersResponse,
  UpdateCustomerRequest,
} from './customer.types';

const client = INVOICE_CONSTRAINTS.client;

export class CreateCustomerDto implements CreateCustomerRequest {
  @ApiProperty({ example: 'Acme Bangladesh Ltd.', minLength: client.name.minLength, maxLength: client.name.maxLength })
  @Sanitize()
  @IsString()
  @Length(client.name.minLength, client.name.maxLength)
  name!: string;

  @ApiProperty({ example: 'finance@acme.example', format: 'email', maxLength: client.email.maxLength })
  @Sanitize({ stripHtml: true, normalizeWhitespace: false })
  @IsEmail()
  @MaxLength(client.email.maxLength)
  email!: string;

  @ApiProperty({ example: 'House 12, Road 8, Gulshan, Dhaka 1212', minLength: client.address.minLength })
  @Sanitize()
  @IsString()
  @Length(client.address.minLength, client.address.maxLength)
  address!: string;

  @ApiPropertyOptional({
    example: 'GB123456789',
    maxLength: 64,
    description: 'A VAT / tax registration number other than a Bangladesh BIN (that goes in `bin`).',
  })
  @IsOptional()
  @Sanitize()
  @IsString()
  @MaxLength(64)
  taxId?: string;

  @ApiPropertyOptional({
    example: '+880 1711-111111',
    maxLength: 20,
    description: 'Billing contact phone. Payment gateways that ask for one (SSLCommerz) receive it.',
  })
  @IsOptional()
  @Sanitize()
  @MaxLength(20)
  @Matches(INVOICE_CONSTRAINTS.client.phone.pattern, { message: 'phone must be a phone number, e.g. +880 1711-111111' })
  phone?: string;

  @ApiPropertyOptional({
    example: '0098765430202',
    pattern: '^\\d{13}$',
    description:
      'Bangladesh BIN of a registered buyer (13 digits): printed as "BIN of Purchaser" on Mushak-6.3 tax invoices, which the buyer needs to claim input VAT. Omit for an unregistered buyer.',
  })
  @IsOptional()
  @Matches(BIN_PATTERN, { message: 'bin must be exactly 13 digits' })
  bin?: string;

  @ApiPropertyOptional({ example: 'Pays by bank transfer.', maxLength: 1000 })
  @IsOptional()
  @Sanitize()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** `bin: null` removes the BIN (@IsOptional lets null through); invoices already issued keep theirs. */
export class UpdateCustomerDto
  extends PartialType(OmitType(CreateCustomerDto, ['bin'] as const))
  implements UpdateCustomerRequest
{
  @ApiPropertyOptional({ example: '0098765430202', nullable: true, type: String, description: 'null removes the BIN.' })
  @IsOptional()
  @Matches(BIN_PATTERN, { message: 'bin must be exactly 13 digits' })
  bin?: string | null;
}

export class FindAllCustomersDto implements FindAllCustomersRequest {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 'acme', description: 'Matches name, email or tax id.' })
  @IsOptional()
  @Sanitize()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CustomerIdGatewayDto implements CustomerIdGatewayRequest {
  @ApiProperty({ example: '662f9d38f2ab7c001f52c9aa' })
  @IsMongoId()
  id!: string;
}

export class CustomerResponseDto implements CustomerResponse {
  @ApiProperty({ example: '662f9d38f2ab7c001f52c9aa' })
  id!: string;

  @ApiProperty({ example: 'Acme Bangladesh Ltd.' })
  name!: string;

  @ApiProperty({ example: 'finance@acme.example' })
  email!: string;

  @ApiProperty({ example: 'House 12, Road 8, Gulshan, Dhaka 1212' })
  address!: string;

  @ApiPropertyOptional({ example: 'GB123456789' })
  taxId?: string;

  @ApiPropertyOptional({ example: '+880 1711-111111' })
  phone?: string;

  @ApiPropertyOptional({ example: '0098765430202' })
  bin?: string;

  @ApiPropertyOptional({ example: 'Pays by bank transfer.' })
  notes?: string;

  @ApiProperty({ example: '2026-10-19T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-10-19T10:00:00.000Z' })
  updatedAt!: string;
}

export class FindAllCustomersResponseDto implements FindAllCustomersResponse {
  @ApiProperty({ type: () => CustomerResponseDto, isArray: true })
  items!: CustomerResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class DeleteCustomerResponseDto implements DeleteCustomerResponse {
  @ApiProperty({ example: '662f9d38f2ab7c001f52c9aa' })
  id!: string;

  @ApiProperty({ example: true })
  deleted!: true;
}
