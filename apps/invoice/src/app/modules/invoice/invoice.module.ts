import { Module } from '@nestjs/common';
import { InvoiceHttpController } from './invoice-http.controller';
import { InvoiceRpcController } from './invoice-rpc.controller';
import { InvoiceService } from './invoice.service';

@Module({
  controllers: [InvoiceHttpController, InvoiceRpcController],
  providers: [InvoiceService],
})
export class InvoiceModule {}
