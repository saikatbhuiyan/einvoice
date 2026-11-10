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
import {
  CreatePaymentLinkDto,
  LedgerEntryResponseDto,
  RecordPaymentDto,
  RefundDto,
  SslCommerzCredentialsDto,
  SslCommerzCredentialsResponseDto,
} from '@libs/interfaces/gateway';
import { Public, RequirePermission } from '@libs/auth';
import { ResponseMessage } from '@libs/interceptors';
import { RateLimit } from '@libs/rate-limit';
import { RATE_LIMIT_MUTATE_BURST, RATE_LIMIT_MUTATE_RATE } from '@libs/constants';
import { IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ApiCorrelationIdHeader,
  ApiEnvelopeResponse,
  ApiProblemResponses,
} from '../../common/swagger/api-response.decorator';
import { PaymentClientService } from './payment-client.service';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

class RefusePaymentDto {
  @ApiPropertyOptional({ example: 'Card reported stolen by the bank.', minLength: 3, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(3, 255)
  reason?: string;
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
      "Returns a hosted payment page for the balance due, or for `amount` (a part of it): SSLCommerz (cards, bKash, Nagad, Rocket, internet banking) for a BDT invoice when the organization has connected its SSLCommerz store, Stripe Checkout otherwise. One link is open at a time: an open link for the same provider and amount is reused while it has time left; asking for another amount replaces it. 409 when nothing is owed; 422 when the amount is more than the balance or outside the provider's per-payment limits (SSLCommerz: BDT 10 to 5,00,000 -- ask for a part, or record a bank transfer).",
  })
  @ApiParam({ name: 'id', description: 'MongoDB ObjectId of the invoice.' })
  @ApiBody({ type: CreatePaymentLinkDto, required: false })
  @ApiProblemResponses(
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.BAD_GATEWAY,
    HttpStatus.SERVICE_UNAVAILABLE,
  )
  createPaymentLink(@Param('id') id: string, @Body() body: CreatePaymentLinkDto = {}) {
    return this.paymentClient.createCheckoutSession(id, body?.amount);
  }

  @Get('invoices/:id/payments')
  @ApiBearerAuth('jwt')
  @RequirePermission('payment:read')
  @ResponseMessage('Payments retrieved successfully')
  @ApiOperation({
    summary: "An invoice's payments and refunds",
    description:
      'The ledger for the invoice, oldest first: every payment (online or recorded by hand) and refund, with its state, and for a payment how much of it has been refunded.',
  })
  @ApiParam({ name: 'id', description: 'MongoDB ObjectId of the invoice.' })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Ledger entries.',
    model: LedgerEntryResponseDto,
    message: 'Payments retrieved successfully',
    isArray: true,
    dataExample: [],
  })
  @ApiProblemResponses(HttpStatus.BAD_GATEWAY)
  listPayments(@Param('id') id: string) {
    return this.paymentClient.listLedger(id);
  }

  @Post('invoices/:id/payments')
  @ApiBearerAuth('jwt')
  @RequirePermission('payment:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Payment recorded successfully')
  @ApiOperation({
    summary: 'Record a payment received outside the gateways',
    description:
      'A bank transfer, cheque, cash or mobile-money payment. At most the balance due; the invoice becomes paid when the balance reaches 0.',
  })
  @ApiParam({ name: 'id', description: 'MongoDB ObjectId of the invoice.' })
  @ApiBody({ type: RecordPaymentDto })
  @ApiProblemResponses(
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.CONFLICT,
    HttpStatus.NOT_FOUND,
    HttpStatus.BAD_GATEWAY,
  )
  recordPayment(@Param('id') id: string, @Body() body: RecordPaymentDto) {
    return this.paymentClient.recordPayment(id, body);
  }

  @Post('invoices/:id/refunds')
  @ApiBearerAuth('jwt')
  @RequirePermission('payment:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Refund started successfully')
  @ApiOperation({
    summary: 'Refund money from one payment',
    description:
      "Online payments are refunded through their provider (Stripe settles at once; SSLCommerz refunds are pending until the provider completes them). Payments made by hand, or with returnedOutsideSystem, are recorded as returned. At most what is left of the payment; a settled refund reopens the invoice's balance.",
  })
  @ApiParam({ name: 'id', description: 'MongoDB ObjectId of the invoice.' })
  @ApiBody({ type: RefundDto })
  @ApiProblemResponses(
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.CONFLICT,
    HttpStatus.NOT_FOUND,
    HttpStatus.BAD_GATEWAY,
  )
  refund(@Param('id') id: string, @Body() body: RefundDto) {
    return this.paymentClient.refund(id, body);
  }

  @Get('payments/attention')
  @ApiBearerAuth('jwt')
  @RequirePermission('payment:read')
  @ResponseMessage('Payments needing attention retrieved successfully')
  @ApiOperation({
    summary: 'Payments waiting for a person',
    description:
      'Held as high risk (review_required), or money that could not be settled on its invoice (reconciliation_required: the invoice was cancelled, overpaid, or the amount did not match).',
  })
  @ApiProblemResponses(HttpStatus.BAD_GATEWAY)
  listAttention() {
    return this.paymentClient.listAttention();
  }

  @Post('payments/:paymentId/accept')
  @ApiBearerAuth('jwt')
  @RequirePermission('payment:write')
  @ResponseMessage('Payment accepted successfully')
  @ApiOperation({ summary: 'Accept a payment held as high risk', description: 'It counts on the invoice from now on.' })
  @ApiParam({ name: 'paymentId', description: 'The checkout payment id (from payments/attention).' })
  @ApiProblemResponses(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.BAD_GATEWAY)
  acceptHeld(@Param('paymentId') paymentId: string) {
    return this.paymentClient.acceptHeld(paymentId);
  }

  @Post('payments/:paymentId/refuse')
  @ApiBearerAuth('jwt')
  @RequirePermission('payment:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Payment refused and refund started successfully')
  @ApiOperation({
    summary: 'Refuse a held or unreconcilable payment',
    description: 'Everything left of it is refunded through its provider.',
  })
  @ApiParam({ name: 'paymentId', description: 'The checkout payment id (from payments/attention).' })
  @ApiBody({ type: RefusePaymentDto, required: false })
  @ApiProblemResponses(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.BAD_GATEWAY)
  refuseHeld(@Param('paymentId') paymentId: string, @Body() body: RefusePaymentDto = {}) {
    return this.paymentClient.refuseHeld(paymentId, body?.reason ?? '');
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
