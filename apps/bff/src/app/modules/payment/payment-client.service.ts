import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import { BaseTcpClient, ServiceName, TCP_CLIENT_TOKENS, TCP_PATTERNS } from '@libs/transports';
import type {
  CreateCheckoutSessionResponse,
  PaymentOutcome,
  SslCommerzCredentialsRequest,
  SslCommerzCredentialsResponse,
  SslCommerzNotification,
} from '@libs/interfaces/gateway';

export type CreateCheckoutSessionGatewayResponse = CreateCheckoutSessionResponse;

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

  async notifySslCommerz(notification: SslCommerzNotification): Promise<PaymentOutcome> {
    return this.send<PaymentOutcome, SslCommerzNotification>(TCP_PATTERNS.PAYMENT.SSLCOMMERZ_NOTIFY, notification);
  }

  async getSslCommerzCredentials(): Promise<SslCommerzCredentialsResponse> {
    return this.send<SslCommerzCredentialsResponse, Record<string, never>>(
      TCP_PATTERNS.PAYMENT.SSLCOMMERZ_CREDENTIALS_GET,
      {},
    );
  }

  async setSslCommerzCredentials(data: SslCommerzCredentialsRequest): Promise<SslCommerzCredentialsResponse> {
    return this.send<SslCommerzCredentialsResponse, SslCommerzCredentialsRequest>(
      TCP_PATTERNS.PAYMENT.SSLCOMMERZ_CREDENTIALS_SET,
      data,
    );
  }

  async deleteSslCommerzCredentials(): Promise<{ provider: 'sslcommerz'; deleted: true }> {
    return this.send<{ provider: 'sslcommerz'; deleted: true }, Record<string, never>>(
      TCP_PATTERNS.PAYMENT.SSLCOMMERZ_CREDENTIALS_DELETE,
      {},
    );
  }

  async handleWebhookEvent(rawBodyBase64: string, signature: string): Promise<void> {
    await this.send<{ received: boolean }, { rawBodyBase64: string; signature: string }>(TCP_PATTERNS.PAYMENT.WEBHOOK, {
      rawBodyBase64,
      signature,
    });
  }
}
