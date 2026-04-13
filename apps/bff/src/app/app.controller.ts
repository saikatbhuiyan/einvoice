import { Controller, Get, Inject, Param, UseInterceptors } from '@nestjs/common';
import { InvoiceClientService } from './invoice-client.service';

@Controller('invoice')
export class AppController {
  constructor(private readonly invoiceClient: InvoiceClientService) {}

  @Get(':id')
  async getSingleInvoice(@Param('id') id: string) {
    return this.invoiceClient.getInvoiceInfo(Number(id));
  }
}
