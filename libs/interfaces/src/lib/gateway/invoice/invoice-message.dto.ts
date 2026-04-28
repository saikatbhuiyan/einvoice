import { Type } from 'class-transformer';
import { IsDefined, IsMongoId, ValidateNested } from 'class-validator';
import type {
  DeleteInvoiceGatewayRequest,
  FindOneInvoiceGatewayRequest,
  InvoiceIdGatewayRequest,
  UpdateInvoiceGatewayRequest,
} from './invoice.types';
import { UpdateInvoiceDto } from './update-invoice.dto';

export class InvoiceIdGatewayDto implements InvoiceIdGatewayRequest {
  @IsMongoId()
  id!: string;
}

export class FindOneInvoiceGatewayDto extends InvoiceIdGatewayDto implements FindOneInvoiceGatewayRequest {}

export class DeleteInvoiceGatewayDto extends InvoiceIdGatewayDto implements DeleteInvoiceGatewayRequest {}

export class UpdateInvoiceGatewayDto extends InvoiceIdGatewayDto implements UpdateInvoiceGatewayRequest {
  @IsDefined()
  @ValidateNested()
  @Type(() => UpdateInvoiceDto)
  data!: UpdateInvoiceDto;
}
