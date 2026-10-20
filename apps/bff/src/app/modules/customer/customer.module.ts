import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { createTcpClientConfig, ServiceName } from '@libs/transports';
import { InvoiceModule } from '../invoice/invoice.module';
import { CustomerClientService } from './customer-client.service';
import { CustomerController } from './customer.controller';

@Module({
  imports: [ClientsModule.register([createTcpClientConfig(ServiceName.INVOICE)]), InvoiceModule],
  controllers: [CustomerController],
  providers: [CustomerClientService],
})
export class CustomerModule {}
