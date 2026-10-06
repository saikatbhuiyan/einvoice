import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { createTcpClientConfig, ServiceName } from '@libs/transports';
import { PaymentClientService } from './payment-client.service';
import { PaymentController } from './payment.controller';

@Module({
  imports: [ClientsModule.register([createTcpClientConfig(ServiceName.PAYMENT)])],
  controllers: [PaymentController],
  providers: [PaymentClientService],
})
export class PaymentModule {}
