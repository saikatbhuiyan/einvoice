import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CUSTOMER_MODEL_DEFINITION } from '@libs/schemas';
import { CustomerRepository } from './customer.repository';
import { CustomerService } from './customer.service';
import { CustomerRpcController } from './customer-rpc.controller';
import { CustomerHttpController } from './customer-http.controller';

@Module({
  imports: [MongooseModule.forFeature([CUSTOMER_MODEL_DEFINITION])],
  controllers: [CustomerRpcController, CustomerHttpController],
  providers: [CustomerRepository, CustomerService],
  exports: [CustomerService],
})
export class CustomerModule {}
