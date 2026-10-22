import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceName, TcpClientModule } from '@libs/transports';
import { PaymentEntity } from '../../../database/entities/payment.entity';
import { ProviderCredentialEntity } from '../../../database/entities/provider-credential.entity';
import { ProviderCredentialsService } from './credentials/provider-credentials.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { SslCommerzClient } from './sslcommerz/sslcommerz.client';
import { SslCommerzPaymentProvider } from './sslcommerz/sslcommerz-payment.provider';
import { SSLCOMMERZ_OPTIONS, type SslCommerzOptions } from './sslcommerz/sslcommerz.options';
import { CONFIGURATION } from '../../../configuration';
import { PaymentHttpController } from './payment-http.controller';
import { PaymentRpcController } from './payment-rpc.controller';
import { InvoiceEventsController } from './invoice-events.controller';
import { PaymentService } from './payment.service';
import { PaymentRepository } from './payment.repository';
import { PAYMENT_REPOSITORY } from './payment.repository.interface';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { StripePaymentProvider } from './stripe-payment.provider';
import { InvoiceClientService } from './invoice-client.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentEntity, ProviderCredentialEntity]),
    TcpClientModule.forServices([ServiceName.INVOICE]),
  ],
  controllers: [PaymentHttpController, PaymentRpcController, InvoiceEventsController],
  providers: [
    PaymentService,
    InvoiceClientService,
    { provide: PAYMENT_REPOSITORY, useClass: PaymentRepository },
    { provide: PAYMENT_PROVIDER, useClass: StripePaymentProvider },
    // Organizations' own SSLCommerz stores, chosen per checkout by the registry.
    { provide: SslCommerzClient, useValue: new SslCommerzClient() },
    {
      provide: SSLCOMMERZ_OPTIONS,
      useFactory: (): SslCommerzOptions => ({
        credentialsKey: CONFIGURATION.SSLCOMMERZ_CONFIG.PAYMENT_CREDENTIALS_KEY,
        publicBaseUrl: CONFIGURATION.SSLCOMMERZ_CONFIG.PAYMENT_PUBLIC_BASE_URL,
      }),
    },
    ProviderCredentialsService,
    SslCommerzPaymentProvider,
    PaymentProviderRegistry,
  ],
})
export class PaymentModule {}
