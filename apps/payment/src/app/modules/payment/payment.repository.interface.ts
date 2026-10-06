import { PaymentEntity, PaymentStatus } from '../../../database/entities/payment.entity';

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');

export interface CreatePaymentRecord {
  invoiceId: string;
  provider: string;
  providerSessionId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  checkoutUrl: string;
}

export interface IPaymentRepository {
  create(data: CreatePaymentRecord): Promise<PaymentEntity>;

  findByProviderSessionId(providerSessionId: string): Promise<PaymentEntity | null>;

  updateStatus(id: string, status: PaymentStatus): Promise<PaymentEntity | null>;
}
