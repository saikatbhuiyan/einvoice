import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Sanitize } from '@libs/decorators';
import {
  BIN_PATTERN,
  DEFAULT_REMINDER_OFFSETS_DAYS,
  TAX_IDENTITY_CONSTRAINTS,
  reminderScheduleProblem,
  timeZoneProblem,
  type AuthorizedSignatory,
} from '@libs/shared/types';
import type {
  CreateOrganizationAdminRequest,
  CreateOrganizationRequest,
  UpdateCurrentOrganizationRequest,
} from './organization.types';

const INVOICE_PREFIX = /^[A-Z0-9]{1,10}$/;

/** The same rule user-access re-checks (RPC payloads skip DTO validation). */
@ValidatorConstraint({ name: 'timeZone' })
class TimeZoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return timeZoneProblem(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return timeZoneProblem(args.value) ?? '';
  }
}

export class AuthorizedSignatoryInputDto implements AuthorizedSignatory {
  @ApiProperty({ example: 'Rahim Uddin', minLength: 2, maxLength: 120 })
  @Sanitize()
  @IsString()
  @Length(TAX_IDENTITY_CONSTRAINTS.signatory.name.minLength, TAX_IDENTITY_CONSTRAINTS.signatory.name.maxLength)
  name!: string;

  @ApiProperty({ example: 'Accounts Manager', minLength: 2, maxLength: 80 })
  @Sanitize()
  @IsString()
  @Length(
    TAX_IDENTITY_CONSTRAINTS.signatory.designation.minLength,
    TAX_IDENTITY_CONSTRAINTS.signatory.designation.maxLength,
  )
  designation!: string;
}

/** The same rule user-access re-checks (RPC payloads skip DTO validation). */
@ValidatorConstraint({ name: 'reminderSchedule' })
class ReminderScheduleConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return reminderScheduleProblem(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return reminderScheduleProblem(args.value) ?? 'reminderOffsetsDays is invalid.';
  }
}

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
  @Matches(INVOICE_PREFIX, { message: 'invoicePrefix must be 1-10 upper-case letters or digits' })
  invoicePrefix?: string;

  @ApiProperty({ type: () => CreateOrganizationAdminDto, description: "The organization's first administrator." })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateOrganizationAdminDto)
  admin!: CreateOrganizationAdminDto;
}

export class UpdateCurrentOrganizationDto implements UpdateCurrentOrganizationRequest {
  @ApiPropertyOptional({ example: 'Acme Ltd.', minLength: 2, maxLength: 160 })
  @IsOptional()
  @Sanitize()
  @IsString()
  @Length(2, 160)
  name?: string;

  @ApiPropertyOptional({
    example: 'ACME',
    pattern: '^[A-Z0-9]{1,10}$',
    description: 'Applies to invoices issued from now on; the yearly sequence continues under the new prefix.',
  })
  @IsOptional()
  @Matches(INVOICE_PREFIX, { message: 'invoicePrefix must be 1-10 upper-case letters or digits' })
  invoicePrefix?: string;

  @ApiPropertyOptional({
    example: [...DEFAULT_REMINDER_OFFSETS_DAYS],
    type: [Number],
    description:
      "Payment reminders, in days after the due date: whole days 1-365, strictly ascending, at most 10. An empty list turns reminders off. Applies from each invoice's next reminder.",
  })
  @IsOptional()
  @Validate(ReminderScheduleConstraint)
  reminderOffsetsDays?: number[];

  @ApiPropertyOptional({
    example: '0012345670101',
    nullable: true,
    type: String,
    description:
      'Bangladesh Business Identification Number, 13 digits; null removes it. With a BIN, BDT invoices are issued as Mushak-6.3 tax invoices, and the organization needs an address. Setting one also sets timeZone to Asia/Dhaka unless a zone is already set or given.',
  })
  @IsOptional()
  @Matches(BIN_PATTERN, { message: 'bin must be exactly 13 digits' })
  bin?: string | null;

  @ApiPropertyOptional({
    example: 'House 12, Road 8, Gulshan-1, Dhaka 1212',
    nullable: true,
    type: String,
    description: 'The challan-issuing address printed on tax invoices; null removes it.',
  })
  @IsOptional()
  @Sanitize()
  @IsString()
  @Length(TAX_IDENTITY_CONSTRAINTS.address.minLength, TAX_IDENTITY_CONSTRAINTS.address.maxLength)
  address?: string | null;

  @ApiPropertyOptional({
    example: 'Asia/Dhaka',
    description:
      'IANA time zone: printed dates and times of issue, and which year an invoice is numbered in. Applies to invoices issued from now on.',
  })
  @IsOptional()
  @Validate(TimeZoneConstraint)
  timeZone?: string;

  @ApiPropertyOptional({
    type: () => AuthorizedSignatoryInputDto,
    nullable: true,
    description: 'Printed as the officer-in-charge on tax invoices issued from now on; null removes it.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AuthorizedSignatoryInputDto)
  authorizedSignatory?: AuthorizedSignatoryInputDto | null;
}
