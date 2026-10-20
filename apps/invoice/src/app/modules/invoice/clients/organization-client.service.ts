import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import type { OrganizationInvoiceSettings } from '@libs/interfaces/gateway';
import { BaseTcpClient, ServiceName, TCP_CLIENT_TOKENS, TCP_PATTERNS } from '@libs/transports';

/** invoice → user-access: the invoice-numbering settings of the organization in the current context. */
@Injectable()
export class OrganizationClientService extends BaseTcpClient {
  protected readonly logger = new Logger(OrganizationClientService.name);
  protected readonly serviceName = ServiceName.USER;
  protected override readonly sourceService = 'invoice';

  constructor(
    @Inject(TCP_CLIENT_TOKENS[ServiceName.USER])
    protected readonly client: ClientProxy,
    @Optional() @Inject(CIRCUIT_BREAKER_FACTORY) circuitBreakerFactory?: CircuitBreakerFactory,
  ) {
    super(circuitBreakerFactory);
  }

  async findInvoiceSettings(): Promise<OrganizationInvoiceSettings> {
    return this.send<OrganizationInvoiceSettings, undefined>(TCP_PATTERNS.ORGANIZATION.INVOICE_SETTINGS, undefined);
  }
}
