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
import { DEFAULT_REMINDER_OFFSETS_DAYS, reminderScheduleProblem } from '@libs/shared/types';
import type {
  CreateOrganizationAdminRequest,
  CreateOrganizationRequest,
  UpdateCurrentOrganizationRequest,
} from './organization.types';

const INVOICE_PREFIX = /^[A-Z0-9]{1,10}$/;

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
}
