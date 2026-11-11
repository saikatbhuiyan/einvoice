import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Sanitize } from '@libs/decorators';
import { MANUAL_PAYMENT_METHODS, PAYMENT_METHODS } from './payment.types';
import type {
  CreatePaymentLinkRequest,
  LedgerApplyState,
  LedgerEntryKind,
  LedgerEntryResponse,
  LedgerEntryState,
  ManualPaymentMethod,
  PaymentMethod,
  RecordPaymentRequest,
  RefundRequest,
  SslCommerzCredentialsRequest,
  SslCommerzCredentialsResponse,
} from './payment.types';

export class SslCommerzCredentialsDto implements SslCommerzCredentialsRequest {
  @ApiProperty({ example: 'acmeltd0abc1234', maxLength: 30, description: 'SSLCommerz Store ID.' })
  @IsString()
  @Length(1, 30)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'storeId may contain letters, digits, - and _ only' })
  storeId!: string;

  @ApiProperty({
    example: 'acmeltd0abc1234@ssl',
    maxLength: 64,
    writeOnly: true,
    description: 'SSLCommerz Store Password. Stored encrypted; never returned by the API.',
  })
  @IsString()
  @Length(1, 64)
  storePassword!: string;

  @ApiProperty({
    example: true,
    description: 'true for a sandbox store (testing), false for a live store (real money).',
  })
  @IsBoolean()
  sandbox!: boolean;
}

export class SslCommerzCredentialsResponseDto implements SslCommerzCredentialsResponse {
  @ApiProperty({ example: 'sslcommerz', enum: ['sslcommerz'] })
  provider!: 'sslcommerz';

  @ApiProperty({ example: 'acmeltd0abc1234' })
  storeId!: string;

  @ApiProperty({ example: true })
  sandbox!: boolean;

  @ApiProperty({ example: '2026-10-22T10:00:00.000Z', format: 'date-time' })
  configuredAt!: string;
}

const isoDate = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

export class CreatePaymentLinkDto implements CreatePaymentLinkRequest {
  @ApiPropertyOptional({
    example: 500000,
    description:
      "Part of the balance to collect with this link (decimal, the invoice's currency). Omit for the whole balance. Required when the balance exceeds the provider's per-payment limit (SSLCommerz: BDT 5,00,000).",
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;
}

export class RecordPaymentDto implements RecordPaymentRequest {
  @ApiProperty({ example: 380000, description: "Amount received, in the invoice's currency. At most the balance due." })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ enum: MANUAL_PAYMENT_METHODS, example: 'bank_transfer' })
  @IsIn(MANUAL_PAYMENT_METHODS)
  method!: ManualPaymentMethod;

  @ApiProperty({ example: '2026-10-22', description: 'When the money was received.' })
  @Matches(isoDate, { message: 'occurredAt must be an ISO date or date-time' })
  occurredAt!: string;

  @ApiPropertyOptional({ example: 'DBBL-TT-778812', maxLength: 128 })
  @IsOptional()
  @Sanitize()
  @IsString()
  @MaxLength(128)
  reference?: string;

  @ApiPropertyOptional({ example: 'Second instalment by RTGS.', maxLength: 500 })
  @IsOptional()
  @Sanitize()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RefundDto implements RefundRequest {
  @ApiProperty({
    example: '6c0f3a52-2f0e-4c1b-9a51-0d2f7b6c9e10',
    description: 'The payment (ledger entry) to refund from.',
  })
  @IsUUID()
  paymentEntryId!: string;

  @ApiProperty({ example: 120, description: 'At most what is left of that payment after earlier refunds.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 'Overpaid: charged twice.', maxLength: 255 })
  @Sanitize()
  @IsString()
  @Length(3, 255)
  reason!: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'true: the money was already returned outside this system (provider dashboard, bank transfer back) -- only record it. Otherwise online payments are refunded through their provider.',
  })
  @IsOptional()
  @IsBoolean()
  returnedOutsideSystem?: boolean;
}

export class LedgerEntryResponseDto implements LedgerEntryResponse {
  @ApiProperty({ example: '6c0f3a52-2f0e-4c1b-9a51-0d2f7b6c9e10' }) id!: string;
  @ApiProperty({ example: '6ada3c39e583d34958de964d' }) invoiceId!: string;
  @ApiProperty({ enum: ['payment', 'refund'] }) kind!: LedgerEntryKind;
  @ApiProperty({ enum: PAYMENT_METHODS }) method!: PaymentMethod;
  @ApiProperty({ example: 500000 }) amount!: number;
  @ApiProperty({ example: 'BDT' }) currency!: string;
  @ApiProperty({ enum: ['settled', 'pending', 'failed', 'unknown'] }) state!: LedgerEntryState;
  @ApiProperty({ enum: ['pending', 'applied', 'held', 'refused', 'not_applicable'] }) applyState!: LedgerApplyState;
  @ApiPropertyOptional() refundOfEntryId?: string;
  @ApiPropertyOptional({ example: 0 }) refundedAmount?: number;
  @ApiPropertyOptional() reference?: string;
  @ApiPropertyOptional() note?: string;
  @ApiPropertyOptional() failureReason?: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiPropertyOptional() recordedBy?: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
