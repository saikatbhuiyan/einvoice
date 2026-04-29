import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDefined, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { CreateInvoiceRequest } from './invoice.types';
import { ClientSnapshotDto, InvoiceFieldsDto, InvoiceItemDto } from './invoice-fields.dto';

export class CreateInvoiceDto extends InvoiceFieldsDto implements CreateInvoiceRequest {
  @ApiProperty({
    type: () => ClientSnapshotDto,
    description: 'Client details captured as an immutable invoice snapshot.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => ClientSnapshotDto)
  client!: ClientSnapshotDto;

  @ApiProperty({
    type: () => InvoiceItemDto,
    isArray: true,
    minItems: 1,
    description: 'One or more billable invoice line items.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items!: InvoiceItemDto[];
}
