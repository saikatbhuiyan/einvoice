import { Controller, Get } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AppService } from './app.service';
import { TCP_PATTERNS } from '@libs/transports';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getData() {
    return this.appService.getData();
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.FIND_ONE)
  getInvoice(@Payload() data: { invoiceId: number }) {
    // Calling your service directly
    // return this.appService.findOne(data.invoiceId);
    return {
      invoiceId: data.invoiceId,
      amount: 450.5,
    };
  }
}
