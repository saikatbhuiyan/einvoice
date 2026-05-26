import { Type } from 'class-transformer';
import { IsDefined, IsMongoId, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type {
  DeleteInvoiceGatewayRequest,
  FindOneInvoiceGatewayRequest,
  InvoiceIdGatewayRequest,
  UpdateInvoiceGatewayRequest,
} from './invoice.types';
import { UpdateInvoiceDto } from './update-invoice.dto';

export class InvoiceIdGatewayDto implements InvoiceIdGatewayRequest {
  @ApiProperty({
    example: '662f9d38f2ab7c001f52c901',
    pattern: '^[a-fA-F0-9]{24}$',
    description: 'MongoDB ObjectId of the invoice.',
  })
  @IsMongoId()
  id!: string;
}

export class FindOneInvoiceGatewayDto extends InvoiceIdGatewayDto implements FindOneInvoiceGatewayRequest {}

export class DeleteInvoiceGatewayDto extends InvoiceIdGatewayDto implements DeleteInvoiceGatewayRequest {}

export class UpdateInvoiceGatewayDto extends InvoiceIdGatewayDto implements UpdateInvoiceGatewayRequest {
  @ApiProperty({
    type: () => UpdateInvoiceDto,
    description: 'Invoice fields to update.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => UpdateInvoiceDto)
  data!: UpdateInvoiceDto;
}
