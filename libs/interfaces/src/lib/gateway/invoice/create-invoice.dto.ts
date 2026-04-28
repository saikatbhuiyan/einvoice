import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDefined, ValidateNested } from 'class-validator';
import type { CreateInvoiceRequest } from './invoice.types';
import { ClientSnapshotDto, InvoiceFieldsDto, InvoiceItemDto } from './invoice-fields.dto';

export class CreateInvoiceDto extends InvoiceFieldsDto implements CreateInvoiceRequest {
  @IsDefined()
  @ValidateNested()
  @Type(() => ClientSnapshotDto)
  client!: ClientSnapshotDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items!: InvoiceItemDto[];
}
