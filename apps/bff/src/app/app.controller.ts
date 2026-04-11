import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    @Inject('INVOICE_SERVICE') private readonly invoiceService: ClientProxy,
  ) {}

  @Get()
  getData() {
    return this.appService.getData();
  }

  @Get('invoice')
  async getInvoice() {
    const result = await firstValueFrom(this.invoiceService.send<string, number>('get_invoice', 1));
    return result;
  }
}
