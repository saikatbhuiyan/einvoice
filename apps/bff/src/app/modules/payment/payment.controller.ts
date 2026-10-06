import { BadRequestException, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public, RequirePermission } from '@libs/auth';
import { ResponseMessage } from '@libs/interceptors';
import { RateLimit } from '@libs/rate-limit';
import { RATE_LIMIT_MUTATE_BURST, RATE_LIMIT_MUTATE_RATE } from '@libs/constants';
import { ApiCorrelationIdHeader, ApiProblemResponses } from '../../common/swagger/api-response.decorator';
import { PaymentClientService } from './payment-client.service';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

@ApiTags('Payments')
@ApiCorrelationIdHeader()
@Controller()
export class PaymentController {
  constructor(private readonly paymentClient: PaymentClientService) {}

  @Post('invoices/:id/payment-link')
  @ApiBearerAuth('jwt')
  @RequirePermission('invoice:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Payment link created successfully')
  @ApiOperation({
    summary: 'Create a Stripe Checkout payment link for an invoice',
    description: 'Creates a Stripe Checkout session for the invoice total and returns its URL.',
  })
  @ApiParam({ name: 'id', description: 'MongoDB ObjectId of the invoice.' })
  @ApiProblemResponses(HttpStatus.NOT_FOUND, HttpStatus.BAD_GATEWAY, HttpStatus.SERVICE_UNAVAILABLE)
  createPaymentLink(@Param('id') id: string) {
    return this.paymentClient.createCheckoutSession(id);
  }

  // @Public(): Stripe can't present a Keycloak bearer token, so this route can never go through
  // JwtAuthGuard/PermissionGuard -- the real trust boundary is Stripe's own signature, verified
  // inside apps/payment (see PaymentRpcController.webhook's comment). bff never calls
  // stripe.webhooks.constructEvent itself; it only relays the raw bytes + signature header, so the
  // Stripe webhook secret never needs to exist in bff's environment at all.
  @Public()
  @Post('payments/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleWebhook(@Req() req: RawBodyRequest, @Headers('stripe-signature') signature?: string) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw request body.');
    }
    if (!signature) {
      throw new BadRequestException('Missing "stripe-signature" header.');
    }

    await this.paymentClient.handleWebhookEvent(req.rawBody.toString('base64'), signature);
    return { received: true };
  }
}
