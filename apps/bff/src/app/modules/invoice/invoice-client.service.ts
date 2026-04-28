import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CreateInvoiceRequest,
  DeleteInvoiceGatewayRequest,
  DeleteInvoiceResponse,
  FindAllInvoicesRequest,
  FindAllInvoicesResponse,
  FindOneInvoiceGatewayRequest,
  InvoiceResponse,
  UpdateInvoiceGatewayRequest,
  UpdateInvoiceRequest,
} from '@libs/interfaces/gateway';
import { BaseTcpClient, ServiceName, TCP_CLIENT_TOKENS, TCP_PATTERNS } from '@libs/transports';

@Injectable()
export class InvoiceClientService extends BaseTcpClient {
  protected readonly logger = new Logger(InvoiceClientService.name);

  constructor(
    @Inject(TCP_CLIENT_TOKENS[ServiceName.INVOICE])
    protected readonly client: ClientProxy,
  ) {
    super();
  }

  async createInvoice(data: CreateInvoiceRequest): Promise<InvoiceResponse> {
    return this.send<InvoiceResponse, CreateInvoiceRequest>(TCP_PATTERNS.INVOICE.CREATE, data);
  }

  async findAllInvoices(query: FindAllInvoicesRequest): Promise<FindAllInvoicesResponse> {
    return this.send<FindAllInvoicesResponse, FindAllInvoicesRequest>(TCP_PATTERNS.INVOICE.FIND_ALL, query);
  }

  async findOneInvoice(id: string): Promise<InvoiceResponse> {
    return this.send<InvoiceResponse, FindOneInvoiceGatewayRequest>(TCP_PATTERNS.INVOICE.FIND_ONE, { id });
  }

  async updateInvoice(id: string, data: UpdateInvoiceRequest): Promise<InvoiceResponse> {
    return this.send<InvoiceResponse, UpdateInvoiceGatewayRequest>(TCP_PATTERNS.INVOICE.UPDATE, { id, data });
  }

  async removeInvoice(id: string): Promise<DeleteInvoiceResponse> {
    return this.send<DeleteInvoiceResponse, DeleteInvoiceGatewayRequest>(TCP_PATTERNS.INVOICE.DELETE, { id });
  }
}
