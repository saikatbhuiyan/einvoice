import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceName, TcpClientModule } from '@libs/transports';
import { PaymentEntity } from '../../../database/entities/payment.entity';
import { PaymentHttpController } from './payment-http.controller';
import { PaymentRpcController } from './payment-rpc.controller';
import { PaymentService } from './payment.service';
import { PaymentRepository } from './payment.repository';
import { PAYMENT_REPOSITORY } from './payment.repository.interface';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { StripePaymentProvider } from './stripe-payment.provider';
import { InvoiceClientService } from './invoice-client.service';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentEntity]), TcpClientModule.forServices([ServiceName.INVOICE])],
  controllers: [PaymentHttpController, PaymentRpcController],
  providers: [
    PaymentService,
    InvoiceClientService,
    { provide: PAYMENT_REPOSITORY, useClass: PaymentRepository },
    { provide: PAYMENT_PROVIDER, useClass: StripePaymentProvider },
  ],
})
export class PaymentModule {}
