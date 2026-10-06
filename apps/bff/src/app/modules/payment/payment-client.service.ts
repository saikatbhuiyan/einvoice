import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import { BaseTcpClient, ServiceName, TCP_CLIENT_TOKENS, TCP_PATTERNS } from '@libs/transports';

export interface CreateCheckoutSessionGatewayResponse {
  checkoutUrl: string;
}

@Injectable()
export class PaymentClientService extends BaseTcpClient {
  protected readonly logger = new Logger(PaymentClientService.name);
  protected readonly serviceName = ServiceName.PAYMENT;
  protected override readonly sourceService = 'bff';

  constructor(
    @Inject(TCP_CLIENT_TOKENS[ServiceName.PAYMENT])
    protected readonly client: ClientProxy,
    @Optional() @Inject(CIRCUIT_BREAKER_FACTORY) circuitBreakerFactory?: CircuitBreakerFactory,
  ) {
    super(circuitBreakerFactory);
  }

  async createCheckoutSession(invoiceId: string): Promise<CreateCheckoutSessionGatewayResponse> {
    return this.send<CreateCheckoutSessionGatewayResponse, { invoiceId: string }>(TCP_PATTERNS.PAYMENT.INITIATE, {
      invoiceId,
    });
  }

  async handleWebhookEvent(rawBodyBase64: string, signature: string): Promise<void> {
    await this.send<{ received: boolean }, { rawBodyBase64: string; signature: string }>(TCP_PATTERNS.PAYMENT.WEBHOOK, {
      rawBodyBase64,
      signature,
    });
  }
}
