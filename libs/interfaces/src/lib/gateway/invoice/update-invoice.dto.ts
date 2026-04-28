import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, ValidateNested } from 'class-validator';
import type { UpdateClientSnapshotRequest, UpdateInvoiceItemRequest, UpdateInvoiceRequest } from './invoice.types';
import { ClientSnapshotDto, InvoiceFieldsDto, InvoiceItemDto } from './invoice-fields.dto';

export class UpdateClientSnapshotDto extends PartialType(ClientSnapshotDto) implements UpdateClientSnapshotRequest {}

export class UpdateInvoiceItemDto extends PartialType(InvoiceItemDto) implements UpdateInvoiceItemRequest {}

export class UpdateInvoiceDto extends PartialType(InvoiceFieldsDto) implements UpdateInvoiceRequest {
  @ValidateNested()
  @Type(() => UpdateClientSnapshotDto)
  @IsOptional()
  client?: UpdateClientSnapshotDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateInvoiceItemDto)
  @IsOptional()
  items?: UpdateInvoiceItemDto[];
}
