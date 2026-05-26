import { Module } from '@nestjs/common';
import { CacheModule } from '@libs/cache';
import { InvoiceHttpController } from './invoice-http.controller';
import { InvoiceRpcController } from './invoice-rpc.controller';
import { InvoiceService } from './invoice.service';
import { INVOICE_REPOSITORY } from './invoice.repository.interface';
import { InvoiceRepository } from './invoice.repository';

@Module({
  imports: [CacheModule.forRoot('svc')],
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
