import { DynamicModule, Module, Provider } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { CacheModule } from '@libs/cache';
import { READ_DB } from '@libs/constants';
import { InvoiceModelName } from '@libs/schemas';
import { InvoiceHttpController } from './invoice-http.controller';
import { InvoiceRpcController } from './invoice-rpc.controller';
import { InvoiceService } from './invoice.service';
import { INVOICE_READ_MODEL, INVOICE_REPOSITORY, INVOICE_WRITE_MODEL } from './invoice.repository.interface';
import { InvoiceRepository } from './invoice.repository';

@Module({})
export class InvoiceModule {
  static register(withReadReplicas: boolean): DynamicModule {
    const readModelProvider: Provider = withReadReplicas
      ? { provide: INVOICE_READ_MODEL, useExisting: getModelToken(InvoiceModelName, READ_DB) }
      : { provide: INVOICE_READ_MODEL, useExisting: getModelToken(InvoiceModelName) };

    return {
      module: InvoiceModule,
      imports: [CacheModule.forRoot('svc')],
      controllers: [InvoiceHttpController, InvoiceRpcController],
      providers: [
        InvoiceService,
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
