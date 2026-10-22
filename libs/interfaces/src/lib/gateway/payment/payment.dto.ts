import { IsBoolean, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { SslCommerzCredentialsRequest, SslCommerzCredentialsResponse } from './payment.types';

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
