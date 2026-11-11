import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { TCP_PATTERNS, unwrapRpcPayload, type RpcEnvelope } from '@libs/transports';
import { RequirePermission } from '@libs/auth/require-permission.decorator';
import { Public } from '@libs/auth/public.decorator';
import type {
  RecordPaymentRequest,
  RefundRequest,
  SslCommerzCredentialsRequest,
  SslCommerzNotification,
} from '@libs/interfaces/gateway';
import { LedgerService } from './ledger/ledger.service';
import { PaymentService } from './payment.service';
import { ProviderCredentialsService } from './credentials/provider-credentials.service';

interface CreateCheckoutSessionPayload {
  invoiceId: string;
  /** A part of the balance; omitted for all of it. */
  amount?: number;
}

interface InvoiceLedgerPayload<T = undefined> {
  invoiceId: string;
  data: T;
}

interface AttentionPayload {
  paymentId: string;
  reason?: string;
}

interface WebhookPayload {
  rawBodyBase64: string;
  signature: string;
}

/**
 * Every pattern here names Transport.TCP. payment runs two microservice servers (TCP and the Kafka
 * consumer), and Nest binds a pattern with no transport to *every* server -- the Kafka server would
 * then try to subscribe to these pattern strings as topics, which don't exist, and fail to start.
 */
@Controller()
export class PaymentRpcController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly credentials: ProviderCredentialsService,
    private readonly ledger: LedgerService,
  ) {}

  // Reuses invoice:write rather than a new payment:write permission -- creating a checkout
  // session is, from the caller's point of view, an action against one specific invoice, the same
  // defense-in-depth reasoning media's upload handler already documents.
  @RequirePermission('invoice:write')
  @MessagePattern(TCP_PATTERNS.PAYMENT.INITIATE, Transport.TCP)
  async initiate(@Payload() payload: RpcEnvelope<CreateCheckoutSessionPayload> | CreateCheckoutSessionPayload) {
    const data = unwrapRpcPayload(payload);
    return this.paymentService.createCheckoutSession(data.invoiceId, data.amount);
  }

  // @Public(): this call has no end-user identity to check -- it's bff relaying a Stripe-
  // originated webhook (bff's own HTTP route is itself @Public(), since Stripe can't present a
  // Keycloak token), not a logged-in user's request. Same exception role-grpc.controller.ts's
  // findAllRoles already documents for a different service-to-service case. The actual trust
  // boundary here is Stripe's signature, verified inside PaymentProvider.parseWebhookEvent --
  // never this guard.
  @Public()
  @MessagePattern(TCP_PATTERNS.PAYMENT.WEBHOOK, Transport.TCP)
  async webhook(@Payload() payload: RpcEnvelope<WebhookPayload> | WebhookPayload) {
    const data = unwrapRpcPayload(payload);
    await this.paymentService.handleWebhookEvent(data.rawBodyBase64, data.signature);
    return { received: true };
  }

  // @Public(): bff relaying an SSLCommerz IPN or a payer's browser coming back -- neither carries a
  // user identity. Nothing in the payload is trusted beyond the tran_id: payment asks SSLCommerz
  // itself, with the organization's credentials (PaymentService.handleSslCommerzNotification).
  @Public()
  @MessagePattern(TCP_PATTERNS.PAYMENT.SSLCOMMERZ_NOTIFY, Transport.TCP)
  sslcommerzNotify(@Payload() payload: RpcEnvelope<SslCommerzNotification> | SslCommerzNotification) {
    return this.paymentService.handleSslCommerzNotification(unwrapRpcPayload(payload));
  }

  @RequirePermission('organization:read')
  @MessagePattern(TCP_PATTERNS.PAYMENT.SSLCOMMERZ_CREDENTIALS_GET, Transport.TCP)
  getSslCommerzCredentials() {
    return this.credentials.getSslCommerz();
  }

  @RequirePermission('organization:write')
  @MessagePattern(TCP_PATTERNS.PAYMENT.SSLCOMMERZ_CREDENTIALS_SET, Transport.TCP)
  setSslCommerzCredentials(
    @Payload() payload: RpcEnvelope<SslCommerzCredentialsRequest> | SslCommerzCredentialsRequest,
  ) {
    return this.credentials.setSslCommerz(unwrapRpcPayload(payload));
  }

  @RequirePermission('organization:write')
  @MessagePattern(TCP_PATTERNS.PAYMENT.SSLCOMMERZ_CREDENTIALS_DELETE, Transport.TCP)
  deleteSslCommerzCredentials() {
    return this.credentials.deleteSslCommerz();
  }

  @RequirePermission('payment:read')
  @MessagePattern(TCP_PATTERNS.PAYMENT.LEDGER_LIST, Transport.TCP)
  ledgerList(@Payload() payload: RpcEnvelope<{ invoiceId: string }> | { invoiceId: string }) {
    return this.ledger.list(unwrapRpcPayload(payload).invoiceId);
  }

  @RequirePermission('payment:write')
  @MessagePattern(TCP_PATTERNS.PAYMENT.RECORD_MANUAL, Transport.TCP)
  recordManual(
    @Payload()
    payload: RpcEnvelope<InvoiceLedgerPayload<RecordPaymentRequest>> | InvoiceLedgerPayload<RecordPaymentRequest>,
  ) {
    const { invoiceId, data } = unwrapRpcPayload(payload);
    return this.ledger.recordManual(invoiceId, data);
  }

  @RequirePermission('payment:write')
  @MessagePattern(TCP_PATTERNS.PAYMENT.REFUND, Transport.TCP)
  refund(@Payload() payload: RpcEnvelope<InvoiceLedgerPayload<RefundRequest>> | InvoiceLedgerPayload<RefundRequest>) {
    const { invoiceId, data } = unwrapRpcPayload(payload);
    return this.ledger.refund(invoiceId, data);
  }

  @RequirePermission('payment:read')
  @MessagePattern(TCP_PATTERNS.PAYMENT.ATTENTION_LIST, Transport.TCP)
  attentionList() {
    return this.paymentService.listAttention();
  }

  @RequirePermission('payment:write')
  @MessagePattern(TCP_PATTERNS.PAYMENT.ACCEPT_HELD, Transport.TCP)
  acceptHeld(@Payload() payload: RpcEnvelope<AttentionPayload> | AttentionPayload) {
    return this.paymentService.acceptHeld(unwrapRpcPayload(payload).paymentId);
  }

  @RequirePermission('payment:write')
  @MessagePattern(TCP_PATTERNS.PAYMENT.REFUSE_HELD, Transport.TCP)
  refuseHeld(@Payload() payload: RpcEnvelope<AttentionPayload> | AttentionPayload) {
    const { paymentId, reason } = unwrapRpcPayload(payload);
    return this.paymentService.refuseHeld(paymentId, reason ?? '');
  }
}
