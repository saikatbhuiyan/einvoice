import { InvoiceDocument } from '@libs/schemas';
import { CreateInvoiceRequest, FindAllInvoicesRequest, UpdateInvoiceRequest } from '@libs/interfaces/gateway';

export const INVOICE_REPOSITORY = Symbol('INVOICE_REPOSITORY');

export interface IInvoiceRepository {
  create(data: CreateInvoiceRequest): Promise<InvoiceDocument>;

  findAll(query: FindAllInvoicesRequest): Promise<{
    items: InvoiceDocument[];
    total: number;
  }>;

  findOne(id: string): Promise<InvoiceDocument | null>;

  update(id: string, data: UpdateInvoiceRequest): Promise<InvoiceDocument | null>;

  remove(id: string): Promise<InvoiceDocument | null>;
}
