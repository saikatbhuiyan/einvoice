import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiBody, ApiExcludeEndpoint, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { SslCommerzCredentialsDto, SslCommerzCredentialsResponseDto } from '@libs/interfaces/gateway';
import { Public, RequirePermission } from '@libs/auth';
import { ResponseMessage } from '@libs/interceptors';
import { RateLimit } from '@libs/rate-limit';
import { RATE_LIMIT_MUTATE_BURST, RATE_LIMIT_MUTATE_RATE } from '@libs/constants';
import {
  ApiCorrelationIdHeader,
  ApiEnvelopeResponse,
  ApiProblemResponses,
} from '../../common/swagger/api-response.decorator';
import { PaymentClientService } from './payment-client.service';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

enum SslCommerzReturn {
  success = 'success',
  fail = 'fail',
  cancel = 'cancel',
}

/** SSLCommerz posts form fields; only tran_id is used, and only as "go and check this one". */
function tranIdOf(body: unknown): string {
  const tranId = (body as Record<string, unknown> | undefined)?.['tran_id'];
  if (typeof tranId !== 'string' || tranId.length === 0) {
    throw new BadRequestException('Missing "tran_id".');
  }
  return tranId;
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
    summary: 'Create a payment link for an invoice',
    description:
      "Returns a hosted payment page for the invoice total: SSLCommerz (cards, bKash, Nagad, Rocket, internet banking) for a BDT invoice when the organization has connected its SSLCommerz store, Stripe Checkout otherwise. An open link is reused while it has time left. 422 when the amount is outside the provider's per-payment limits (SSLCommerz: BDT 10 to 5,00,000).",
  })
  @ApiParam({ name: 'id', description: 'MongoDB ObjectId of the invoice.' })
  @ApiProblemResponses(
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.BAD_GATEWAY,
    HttpStatus.SERVICE_UNAVAILABLE,
  )
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

  // @Public(): SSLCommerz's IPN carries no token, and its signature scheme isn't documented. The
  // trust boundary is in payment, which ignores everything here except the tran_id and asks
  // SSLCommerz itself, with the organization's credentials, what happened.
  @Public()
  @Post('payments/sslcommerz/ipn')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async sslcommerzIpn(@Body() body: unknown) {
    await this.paymentClient.notifySslCommerz({ tranId: tranIdOf(body), source: 'ipn' });
    return { received: true };
  }

  // @Public(): the payer's browser, posted back by SSLCommerz's page (success_url/fail_url/
  // cancel_url). Settles the payment the same way as the IPN -- which matters when the IPN can't
  // reach us -- and tells the payer the outcome.
  @Public()
  @Post('payments/sslcommerz/return/:result')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  sslcommerzReturn(
    @Param('result', new ParseEnumPipe(SslCommerzReturn)) result: SslCommerzReturn,
    @Body() body: unknown,
  ) {
    return this.paymentClient.notifySslCommerz({ tranId: tranIdOf(body), source: result });
  }

  @Get('organization/payment-providers/sslcommerz')
  @ApiBearerAuth('jwt')
  @RequirePermission('organization:read')
  @ResponseMessage('SSLCommerz store retrieved successfully')
  @ApiOperation({
    summary: "The organization's SSLCommerz store",
    description: 'Which SSLCommerz store BDT invoices are paid into. The password is never returned.',
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Connected store.',
    model: SslCommerzCredentialsResponseDto,
    message: 'SSLCommerz store retrieved successfully',
    dataExample: {
      provider: 'sslcommerz',
      storeId: 'acmeltd0abc1234',
      sandbox: true,
      configuredAt: '2026-10-22T10:00:00.000Z',
    },
  })
  @ApiProblemResponses(HttpStatus.NOT_FOUND, HttpStatus.BAD_GATEWAY)
  getSslCommerzStore() {
    return this.paymentClient.getSslCommerzCredentials();
  }

  @Put('organization/payment-providers/sslcommerz')
  @ApiBearerAuth('jwt')
  @RequirePermission('organization:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('SSLCommerz store connected successfully')
  @ApiOperation({
    summary: "Connect the organization's SSLCommerz store",
    description:
      'Connects (or replaces) the store BDT invoices are paid into, after SSLCommerz accepts the credentials. The password is stored encrypted and never returned. From then on, payment links for BDT invoices go through SSLCommerz.',
  })
  @ApiBody({ type: SslCommerzCredentialsDto })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Store connected.',
    model: SslCommerzCredentialsResponseDto,
    message: 'SSLCommerz store connected successfully',
    dataExample: {
      provider: 'sslcommerz',
      storeId: 'acmeltd0abc1234',
      sandbox: true,
      configuredAt: '2026-10-22T10:00:00.000Z',
    },
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.BAD_GATEWAY, HttpStatus.SERVICE_UNAVAILABLE)
  setSslCommerzStore(@Body() payload: SslCommerzCredentialsDto) {
    return this.paymentClient.setSslCommerzCredentials(payload);
  }

  @Delete('organization/payment-providers/sslcommerz')
  @ApiBearerAuth('jwt')
  @RequirePermission('organization:write')
  @ResponseMessage('SSLCommerz store disconnected successfully')
  @ApiOperation({
    summary: "Disconnect the organization's SSLCommerz store",
    description:
      'New payment links for BDT invoices go through Stripe again. The store stays on record (disabled) so payments already started through it are still confirmed and settled; reconnecting re-enables it.',
  })
  @ApiProblemResponses(HttpStatus.NOT_FOUND, HttpStatus.BAD_GATEWAY)
  deleteSslCommerzStore() {
    return this.paymentClient.deleteSslCommerzCredentials();
  }
}
