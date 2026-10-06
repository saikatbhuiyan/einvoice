import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import { BaseTcpClient, ServiceName, TCP_CLIENT_TOKENS, TCP_PATTERNS } from '@libs/transports';
import type { InvoiceResponse } from '@libs/interfaces/gateway';

@Injectable()
export class InvoiceClientService extends BaseTcpClient {
  protected readonly logger = new Logger(InvoiceClientService.name);
  protected readonly serviceName = ServiceName.INVOICE;
  protected override readonly sourceService = 'payment';

  constructor(
    @Inject(TCP_CLIENT_TOKENS[ServiceName.INVOICE])
    protected readonly client: ClientProxy,
    @Optional() @Inject(CIRCUIT_BREAKER_FACTORY) circuitBreakerFactory?: CircuitBreakerFactory,
  ) {
    super(circuitBreakerFactory);
  }

  async findOneInvoice(id: string): Promise<InvoiceResponse> {
    return this.send<InvoiceResponse, { id: string }>(TCP_PATTERNS.INVOICE.FIND_ONE, { id });
  }

  async markInvoicePaid(id: string): Promise<InvoiceResponse> {
    return this.send<InvoiceResponse, { id: string }>(TCP_PATTERNS.INVOICE.MARK_PAID, { id });
  }
}
