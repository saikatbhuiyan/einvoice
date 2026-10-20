import { Type } from 'class-transformer';
import { IsDefined, IsEmail, IsOptional, IsString, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Sanitize } from '@libs/decorators';
import type { CreateOrganizationAdminRequest, CreateOrganizationRequest } from './organization.types';

export class CreateOrganizationAdminDto implements CreateOrganizationAdminRequest {
  @ApiProperty({ example: 'owner@acme.example', format: 'email', maxLength: 320 })
  @Sanitize({ stripHtml: true, normalizeWhitespace: false })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: 'Jane Doe', minLength: 1, maxLength: 160 })
  @Sanitize()
  @IsString()
  @Length(1, 160)
  name!: string;
}

export class CreateOrganizationDto implements CreateOrganizationRequest {
  @ApiProperty({ example: 'Acme Ltd.', minLength: 2, maxLength: 160 })
  @Sanitize()
  @IsString()
  @Length(2, 160)
  name!: string;

  @ApiProperty({ example: 'acme', pattern: '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' })
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, {
    message: 'slug must be 1-63 lower-case letters, digits or hyphens, not starting or ending with a hyphen',
  })
  slug!: string;

  @ApiPropertyOptional({ example: 'ACME', pattern: '^[A-Z0-9]{1,10}$', default: 'INV' })
  @IsOptional()
  @Matches(/^[A-Z0-9]{1,10}$/, { message: 'invoicePrefix must be 1-10 upper-case letters or digits' })
  invoicePrefix?: string;

  @ApiProperty({ type: () => CreateOrganizationAdminDto, description: "The organization's first administrator." })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateOrganizationAdminDto)
  admin!: CreateOrganizationAdminDto;
}
