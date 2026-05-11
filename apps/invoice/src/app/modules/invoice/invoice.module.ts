import { Module } from '@nestjs/common';
import { InvoiceHttpController } from './invoice-http.controller';
import { InvoiceRpcController } from './invoice-rpc.controller';
import { InvoiceService } from './invoice.service';
import { INVOICE_REPOSITORY } from './invoice.repository.interface';
import { InvoiceRepository } from './invoice.repository';

@Module({
  controllers: [InvoiceHttpController, InvoiceRpcController],
  providers: [
    InvoiceService,
    {
      provide: INVOICE_REPOSITORY,
      useClass: InvoiceRepository,
    },
  ],
})
export class InvoiceModule {}
