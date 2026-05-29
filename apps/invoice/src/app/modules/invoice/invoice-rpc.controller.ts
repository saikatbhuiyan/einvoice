import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TCP_PATTERNS } from '@libs/transports';
import {
  CreateInvoiceDto,
  DeleteInvoiceGatewayDto,
  FindAllInvoicesDto,
  FindOneInvoiceGatewayDto,
  UpdateInvoiceGatewayDto,
} from '@libs/interfaces/gateway';
import { InvoiceService } from './invoice.service';

@Controller()
export class InvoiceRpcController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @MessagePattern(TCP_PATTERNS.INVOICE.CREATE)
  createByMessage(@Payload() payload: CreateInvoiceDto) {
    return this.invoiceService.create(payload);
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.FIND_ALL)
  findAllByMessage(@Payload() payload: FindAllInvoicesDto = new FindAllInvoicesDto()) {
    return this.invoiceService.findAll(payload);
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.FIND_ONE)
  findOneByMessage(@Payload() payload: FindOneInvoiceGatewayDto) {
    return this.invoiceService.findOne(payload.id);
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.UPDATE)
  updateByMessage(@Payload() payload: UpdateInvoiceGatewayDto) {
    return this.invoiceService.update(payload.id, payload.data, payload.version);
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.DELETE)
  removeByMessage(@Payload() payload: DeleteInvoiceGatewayDto) {
    return this.invoiceService.remove(payload.id, payload.version);
  }
}
