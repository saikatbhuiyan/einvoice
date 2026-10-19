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
  expiresAt: Date;
}

export interface IPaymentRepository {
  create(data: CreatePaymentRecord): Promise<PaymentEntity>;

  findByProviderSessionId(providerSessionId: string): Promise<PaymentEntity | null>;

  /** The invoice's open (pending) session, if any — at most one, by unique index. */
  findOpenByInvoiceId(invoiceId: string): Promise<PaymentEntity | null>;

  /** Whether a payment other than `excludeId` has already been collected for this invoice. */
  hasOtherPaidPayment(invoiceId: string, excludeId: string): Promise<boolean>;

  updateStatus(id: string, status: PaymentStatus): Promise<PaymentEntity | null>;
}
