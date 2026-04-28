import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { createTcpClientConfig, ServiceName } from '@libs/transports';
import { InvoiceClientService } from './invoice-client.service';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';

@Module({
  imports: [ClientsModule.register([createTcpClientConfig(ServiceName.INVOICE)])],
  controllers: [InvoiceController],
  providers: [InvoiceClientService, InvoiceService],
})
export class InvoiceModule {}
