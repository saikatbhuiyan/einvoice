import { Injectable } from '@nestjs/common';
import {
  CreateInvoiceRequest,
  DeleteInvoiceResponse,
  FindAllInvoicesRequest,
  FindAllInvoicesResponse,
  InvoiceResponse,
  UpdateInvoiceRequest,
} from '@libs/interfaces/gateway';
import { InvoiceClientService } from './invoice-client.service';

@Injectable()
export class InvoiceService {
  constructor(private readonly invoiceClient: InvoiceClientService) {}

  create(payload: CreateInvoiceRequest): Promise<InvoiceResponse> {
    return this.invoiceClient.createInvoice(payload);
  }

  findAll(query: FindAllInvoicesRequest): Promise<FindAllInvoicesResponse> {
    return this.invoiceClient.findAllInvoices(query);
  }

  findOne(id: string): Promise<InvoiceResponse> {
    return this.invoiceClient.findOneInvoice(id);
  }

  update(id: string, payload: UpdateInvoiceRequest): Promise<InvoiceResponse> {
    return this.invoiceClient.updateInvoice(id, payload);
  }

  remove(id: string): Promise<DeleteInvoiceResponse> {
    return this.invoiceClient.removeInvoice(id);
  }
}
