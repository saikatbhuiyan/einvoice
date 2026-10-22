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
  SellerSnapshotResponse,
  SupportedCurrency,
} from './invoice.types';

export class ClientSnapshotResponseDto implements ClientSnapshotResponse {
  @ApiProperty({ example: 'Acme Bangladesh Ltd.' })
  name!: string;

  @ApiProperty({ example: 'finance@acme.example', format: 'email' })
  email!: string;

  @ApiProperty({ example: 'House 12, Road 8, Gulshan, Dhaka 1212' })
  address!: string;

  @ApiPropertyOptional({ example: '0098765430202', description: 'Bangladesh BIN of a registered buyer.' })
  bin?: string;
}

export class SignatoryResponseDto {
  @ApiProperty({ example: 'Rahim Uddin' })
  name!: string;

  @ApiProperty({ example: 'Accounts Manager' })
  designation!: string;
}

export class SellerSnapshotResponseDto implements SellerSnapshotResponse {
  @ApiProperty({ example: 'Acme Ltd.' })
  name!: string;

  @ApiPropertyOptional({
    example: '0012345670101',
    description: 'Bangladesh BIN; with one, a BDT invoice is a Mushak-6.3.',
  })
  bin?: string;

  @ApiPropertyOptional({ example: 'House 12, Road 8, Gulshan-1, Dhaka 1212' })
  address?: string;

  @ApiPropertyOptional({ type: () => SignatoryResponseDto })
  authorizedSignatory?: SignatoryResponseDto;

  @ApiProperty({ example: 'Asia/Dhaka' })
  timeZone!: string;
}

export class InvoiceItemResponseDto implements InvoiceItemResponse {
  @ApiPropertyOptional({
    example: '5f1d7c1e-2b9a-4c64-9a7e-3f1c2d4b5a6e',
    description: 'Set when the line came from the catalog.',
  })
  productId?: string;

  @ApiProperty({ example: 'SKU-SUBSCRIPTION-PRO' })
  catalogId!: string;

  @ApiProperty({ example: 'Enterprise subscription' })
  name!: string;

  @ApiPropertyOptional({ example: 'pcs', description: 'Unit of supply.' })
  unit?: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ example: 15000 })
  unitPrice!: number;

  @ApiProperty({ example: 15 })
  vatRate!: number;

  @ApiProperty({ example: 0, description: 'Supplementary duty percentage (Bangladesh).' })
  sdRate!: number;

  @ApiProperty({ example: 30000, description: 'quantity x unitPrice.' })
  net!: number;

  @ApiProperty({ example: 0, description: 'Supplementary duty on net.' })
  sd!: number;

  @ApiProperty({ example: 4500, description: 'VAT on net + SD.' })
  vat!: number;

  @ApiProperty({ example: 34500, description: 'Line total: net + SD + VAT.' })
  total!: number;
}

export class InvoiceResponseDto implements InvoiceResponse {
  @ApiProperty({
    example: '662f9d38f2ab7c001f52c901',
    pattern: '^[a-fA-F0-9]{24}$',
    description: 'Invoice identifier.',
  })
  id!: string;

  @ApiProperty({ example: '6a1f1c2e-0b9d-4d55-9a8b-6b8f7c1d2e3f' })
  organizationId!: string;

  @ApiPropertyOptional({
    example: 'ACME-2026-000042',
    description: 'Assigned when the invoice is issued ({prefix}-{year}-{sequence}); absent on drafts.',
  })
  invoiceNumber?: string;

  @ApiPropertyOptional({ example: 'PO-4711' })
  reference?: string;

  @ApiPropertyOptional({ example: '662f9d38f2ab7c001f52c9aa', nullable: true })
  customerId?: string | null;

  @ApiProperty({ type: () => ClientSnapshotResponseDto })
  client!: ClientSnapshotResponseDto;

  @ApiPropertyOptional({
    type: () => SellerSnapshotResponseDto,
    description: 'The issuing organization as of the moment of issue; absent on drafts.',
  })
  seller?: SellerSnapshotResponseDto;

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

  @ApiProperty({ example: 30000, description: 'Sum of line nets, before SD and VAT.' })
  subtotal!: number;

  @ApiProperty({ example: 0, description: 'Sum of line supplementary duty (Bangladesh); 0 elsewhere.' })
  sdTotal!: number;

  @ApiProperty({ example: 4500, description: 'Total VAT amount.' })
  vatTotal!: number;

  @ApiProperty({ example: 34500, description: 'Invoice grand total including VAT.' })
  total!: number;

  @ApiProperty({
    example: 1,
    description:
      'Optimistic concurrency version. Incremented on each update. Send this value in the If-Match header for update/delete requests.',
  })
  version!: number;

  @ApiPropertyOptional({
    example: 'idempotency-key-uuid-v4',
    description: 'Idempotency key echoed back when provided at creation.',
  })
  idempotencyKey?: string;

  @ApiPropertyOptional({ example: 1, description: 'Payment reminders emailed so far (overdue invoices only).' })
  remindersSent?: number;

  @ApiPropertyOptional({ example: '2026-05-29T00:00:00.000Z', format: 'date-time', nullable: true })
  lastReminderAt?: string | Date | null;

  @ApiPropertyOptional({
    example: '2026-06-04T00:00:00.000Z',
    format: 'date-time',
    nullable: true,
    description: "When the next reminder will be sent (the organization's schedule), or null when none is scheduled.",
  })
  nextReminderAt?: string | Date | null;

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
