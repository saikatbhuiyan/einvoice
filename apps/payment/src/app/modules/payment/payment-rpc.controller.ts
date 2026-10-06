import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TCP_PATTERNS, unwrapRpcPayload, type RpcEnvelope } from '@libs/transports';
import { RequirePermission } from '@libs/auth/require-permission.decorator';
import { Public } from '@libs/auth/public.decorator';
import { PaymentService } from './payment.service';

interface CreateCheckoutSessionPayload {
  invoiceId: string;
}

interface WebhookPayload {
  rawBodyBase64: string;
  signature: string;
}

@Controller()
export class PaymentRpcController {
  constructor(private readonly paymentService: PaymentService) {}

  // Reuses invoice:write rather than a new payment:write permission -- creating a checkout
  // session is, from the caller's point of view, an action against one specific invoice, the same
  // defense-in-depth reasoning media's upload handler already documents.
  @RequirePermission('invoice:write')
  @MessagePattern(TCP_PATTERNS.PAYMENT.INITIATE)
  async initiate(@Payload() payload: RpcEnvelope<CreateCheckoutSessionPayload> | CreateCheckoutSessionPayload) {
    const data = unwrapRpcPayload(payload);
    return this.paymentService.createCheckoutSession(data.invoiceId);
  }

  // @Public(): this call has no end-user identity to check -- it's bff relaying a Stripe-
  // originated webhook (bff's own HTTP route is itself @Public(), since Stripe can't present a
  // Keycloak token), not a logged-in user's request. Same exception role-grpc.controller.ts's
  // findAllRoles already documents for a different service-to-service case. The actual trust
  // boundary here is Stripe's signature, verified inside PaymentProvider.parseWebhookEvent --
  // never this guard.
  @Public()
  @MessagePattern(TCP_PATTERNS.PAYMENT.WEBHOOK)
  async webhook(@Payload() payload: RpcEnvelope<WebhookPayload> | WebhookPayload) {
    const data = unwrapRpcPayload(payload);
    await this.paymentService.handleWebhookEvent(data.rawBodyBase64, data.signature);
    return { received: true };
  }
}
