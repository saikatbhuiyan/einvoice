import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsMongoId, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INVOICE_CONSTRAINTS, PaginationMetaDto } from '@libs/shared/types';
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

  @ApiPropertyOptional({ example: 'BIN-000123456', maxLength: 64, description: 'VAT / tax registration number.' })
  @IsOptional()
  @Sanitize()
  @IsString()
  @MaxLength(64)
  taxId?: string;

  @ApiPropertyOptional({ example: 'Pays by bank transfer.', maxLength: 1000 })
  @IsOptional()
  @Sanitize()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) implements UpdateCustomerRequest {}

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

  @ApiPropertyOptional({ example: 'BIN-000123456' })
  taxId?: string;

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
