import { Body, Controller, Post } from '@nestjs/common';
import { PaymentService } from './payment.service';

@Controller('payments')
export class PaymentHttpController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('checkout-session')
  createCheckoutSession(@Body('invoiceId') invoiceId: string) {
    return this.paymentService.createCheckoutSession(invoiceId);
  }
}
