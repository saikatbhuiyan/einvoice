import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, ValidateNested } from 'class-validator';
import type { UpdateClientSnapshotRequest, UpdateInvoiceItemRequest, UpdateInvoiceRequest } from './invoice.types';
import { ClientSnapshotDto, InvoiceFieldsDto, InvoiceItemDto } from './invoice-fields.dto';

export class UpdateClientSnapshotDto extends PartialType(ClientSnapshotDto) implements UpdateClientSnapshotRequest {}

export class UpdateInvoiceItemDto extends PartialType(InvoiceItemDto) implements UpdateInvoiceItemRequest {}

export class UpdateInvoiceDto extends PartialType(InvoiceFieldsDto) implements UpdateInvoiceRequest {
  @ApiPropertyOptional({
    type: () => UpdateClientSnapshotDto,
    description: 'Partial client snapshot update.',
  })
  @ValidateNested()
  @Type(() => UpdateClientSnapshotDto)
  @IsOptional()
  client?: UpdateClientSnapshotDto;

  @ApiPropertyOptional({
    type: () => UpdateInvoiceItemDto,
    isArray: true,
    minItems: 1,
    description: 'Replace invoice line items with the provided partial item set.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateInvoiceItemDto)
  @IsOptional()
  items?: UpdateInvoiceItemDto[];
}
