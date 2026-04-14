import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { BaseTcpClient, TCP_CLIENT_TOKENS, ServiceName, TCP_PATTERNS } from '@libs/transports';

@Injectable()
export class InvoiceClientService extends BaseTcpClient {
  // 1. Provide the Logger required by the abstract class
  protected readonly logger = new Logger(InvoiceClientService.name);

  constructor(
    // 2. Inject the native NestJS ClientProxy using our custom token
    @Inject(TCP_CLIENT_TOKENS[ServiceName.INVOICE])
    protected readonly client: ClientProxy,
  ) {
    super();
  }

  // --- Example Implementations ---

  async getInvoiceInfo(id: number) {
    // We use this.send() instead of this.client.send() so we get the built-in
    // timeout and error normalization we wrote in BaseTcpClient
    return this.send(TCP_PATTERNS.INVOICE.FIND_ONE, { invoiceId: id });
  }

  async createNewInvoice(data: any) {
    return this.send(TCP_PATTERNS.INVOICE.CREATE, data);
  }

  broadcastInvoiceDeleted(id: number) {
    // Fire-and-forget: we don't wait for a response
    this.emit(TCP_PATTERNS.INVOICE.DELETE, { id });
  }
}
