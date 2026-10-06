import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import {
  BaseTcpClient,
  ServiceName,
  TCP_CLIENT_TOKENS,
  TCP_PATTERNS,
  type GenerateInvoicePdfRequest,
  type GenerateInvoicePdfResponse,
} from '@libs/transports';

@Injectable()
export class PdfGeneratorClientService extends BaseTcpClient {
  protected readonly logger = new Logger(PdfGeneratorClientService.name);
  protected readonly serviceName = ServiceName.PDF_GENERATOR;
  protected override readonly sourceService = 'invoice';

  constructor(
    @Inject(TCP_CLIENT_TOKENS[ServiceName.PDF_GENERATOR])
    protected readonly client: ClientProxy,
    @Optional() @Inject(CIRCUIT_BREAKER_FACTORY) circuitBreakerFactory?: CircuitBreakerFactory,
  ) {
    super(circuitBreakerFactory);
  }

  async generateInvoicePdf(data: GenerateInvoicePdfRequest): Promise<GenerateInvoicePdfResponse> {
    return this.send<GenerateInvoicePdfResponse, GenerateInvoicePdfRequest>(
      TCP_PATTERNS.PDF_GENERATOR.GENERATE_INVOICE_PDF,
      data,
    );
  }
}
