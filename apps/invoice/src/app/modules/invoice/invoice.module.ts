import { DynamicModule, Module, Provider } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { CacheModule } from '@libs/cache';
import { READ_DB } from '@libs/constants';
import { InvoiceModelName } from '@libs/schemas';
import { ServiceName, TcpClientModule } from '@libs/transports';
import { MongooseModule } from '@nestjs/mongoose';
import { INVOICE_COUNTER_MODEL_DEFINITION } from '@libs/schemas';
import { CustomerModule } from '../customer/customer.module';
import { InvoiceNumberingService } from './invoice-numbering.service';
import { OrganizationClientService } from './clients/organization-client.service';
import { OrganizationSettingsService } from './organization-settings.service';
import {
  OVERDUE_SCHEDULER_OPTIONS,
  OverdueScheduler,
  overdueSchedulerOptionsFromEnv,
} from './overdue-scheduler.service';
import { OutboxModule } from '../outbox/outbox.module';
import { InvoiceHttpController } from './invoice-http.controller';
import { InvoiceRpcController } from './invoice-rpc.controller';
import { InvoiceService } from './invoice.service';
import { INVOICE_READ_MODEL, INVOICE_REPOSITORY, INVOICE_WRITE_MODEL } from './invoice.repository.interface';
import { InvoiceRepository } from './invoice.repository';
import { PdfGeneratorClientService } from './clients/pdf-generator-client.service';
import { MediaClientService } from './clients/media-client.service';
import { ProductClientService } from './clients/product-client.service';
import { InvoiceEventsProducerService } from './clients/invoice-events-producer.service';

@Module({})
export class InvoiceModule {
  static register(withReadReplicas: boolean): DynamicModule {
    const readModelProvider: Provider = withReadReplicas
      ? { provide: INVOICE_READ_MODEL, useExisting: getModelToken(InvoiceModelName, READ_DB) }
      : { provide: INVOICE_READ_MODEL, useExisting: getModelToken(InvoiceModelName) };

    return {
      module: InvoiceModule,
      imports: [
        CacheModule.forRoot('svc'),
        // USER: user-access, for the organization's invoicing settings (prefix, reminder schedule).
        // PRODUCT: the organization's catalog, for catalog-backed lines.
        TcpClientModule.forServices([
          ServiceName.PDF_GENERATOR,
          ServiceName.MEDIA,
          ServiceName.USER,
          ServiceName.PRODUCT,
        ]),
        MongooseModule.forFeature([INVOICE_COUNTER_MODEL_DEFINITION]),
        CustomerModule,
        // Events go through the transactional outbox; its relay is the only thing that talks to Kafka.
        OutboxModule,
      ],
      controllers: [InvoiceHttpController, InvoiceRpcController],
      providers: [
        InvoiceService,
        PdfGeneratorClientService,
        MediaClientService,
        ProductClientService,
        InvoiceEventsProducerService,
        InvoiceNumberingService,
        OrganizationClientService,
        OrganizationSettingsService,
        // Marks invoices overdue and sends payment reminders (one leader across instances).
        OverdueScheduler,
        { provide: OVERDUE_SCHEDULER_OPTIONS, useFactory: () => overdueSchedulerOptionsFromEnv() },
        {
          provide: INVOICE_REPOSITORY,
          useClass: InvoiceRepository,
        },
        {
          provide: INVOICE_WRITE_MODEL,
          useExisting: getModelToken(InvoiceModelName),
        },
        readModelProvider,
      ],
    };
  }
}
