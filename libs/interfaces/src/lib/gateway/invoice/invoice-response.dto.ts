import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CursorPaginationMetaDto, PaginationMetaDto } from '@libs/shared/types';
import { INVOICE_STATUSES, SUPPORTED_CURRENCIES } from '@libs/shared/types';
import type {
  ClientSnapshotResponse,
  DeleteInvoiceResponse,
  FindAllInvoicesCursorResponse,
  FindAllInvoicesResponse,
  InvoiceItemResponse,
  InvoiceResponse,
  InvoiceStatus,
  SupportedCurrency,
} from './invoice.types';

export class ClientSnapshotResponseDto implements ClientSnapshotResponse {
  @ApiProperty({ example: 'Acme Bangladesh Ltd.' })
  name!: string;

  @ApiProperty({ example: 'finance@acme.example', format: 'email' })
  email!: string;

  @ApiProperty({ example: 'House 12, Road 8, Gulshan, Dhaka 1212' })
  address!: string;
}

export class InvoiceItemResponseDto implements InvoiceItemResponse {
  @ApiProperty({ example: 'SKU-SUBSCRIPTION-PRO' })
  catalogId!: string;

  @ApiProperty({ example: 'Enterprise subscription' })
  name!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ example: 15000 })
  unitPrice!: number;

  @ApiProperty({ example: 15 })
  vatRate!: number;

  @ApiProperty({ example: 34500, description: 'Line total including VAT.' })
  total!: number;
}

export class InvoiceResponseDto implements InvoiceResponse {
  @ApiProperty({
    example: '662f9d38f2ab7c001f52c901',
    pattern: '^[a-fA-F0-9]{24}$',
    description: 'Invoice identifier.',
  })
  id!: string;

  @ApiProperty({ example: 'INV-2026-0001' })
  invoiceNumber!: string;

  @ApiProperty({ type: () => ClientSnapshotResponseDto })
  client!: ClientSnapshotResponseDto;

  @ApiProperty({ type: () => InvoiceItemResponseDto, isArray: true })
  items!: InvoiceItemResponseDto[];

  @ApiProperty({ enum: SUPPORTED_CURRENCIES, enumName: 'SupportedCurrency', example: 'BDT' })
  currency!: SupportedCurrency;

  @ApiProperty({ enum: INVOICE_STATUSES, enumName: 'InvoiceStatus', example: 'issued' })
  status!: InvoiceStatus;

  @ApiProperty({ example: '2026-04-28', format: 'date' })
  issueDate!: string | Date;

  @ApiPropertyOptional({ example: '2026-05-28', format: 'date' })
  dueDate?: string | Date;

  @ApiPropertyOptional({ example: 'Payment due within 30 days.' })
  notes?: string;

  @ApiProperty({ example: 30000, description: 'Invoice subtotal before VAT.' })
  subtotal!: number;

  @ApiProperty({ example: 4500, description: 'Total VAT amount.' })
  vatTotal!: number;

  @ApiProperty({ example: 34500, description: 'Invoice grand total including VAT.' })
  total!: number;

  @ApiPropertyOptional({
    example: 'idempotency-key-uuid-v4',
    description: 'Idempotency key echoed back when provided at creation.',
  })
  idempotencyKey?: string;

  @ApiProperty({ example: '2026-04-28T10:30:00.000Z', format: 'date-time' })
  createdAt!: string | Date;

  @ApiProperty({ example: '2026-04-28T10:30:00.000Z', format: 'date-time' })
  updatedAt!: string | Date;
}

export class FindAllInvoicesResponseDto implements FindAllInvoicesResponse {
  @ApiProperty({ type: () => InvoiceResponseDto, isArray: true })
  items!: InvoiceResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class FindAllInvoicesCursorResponseDto implements FindAllInvoicesCursorResponse {
  @ApiProperty({ type: () => InvoiceResponseDto, isArray: true })
  items!: InvoiceResponseDto[];

  @ApiProperty({ type: () => CursorPaginationMetaDto })
  meta!: CursorPaginationMetaDto;
}

export class DeleteInvoiceResponseDto implements DeleteInvoiceResponse {
  @ApiProperty({
    example: '662f9d38f2ab7c001f52c901',
    pattern: '^[a-fA-F0-9]{24}$',
    description: 'Deleted invoice identifier.',
  })
  id!: string;

  @ApiProperty({ example: true })
  deleted!: true;
}
