import { PaymentEntity, PaymentStatus } from '../../../database/entities/payment.entity';

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');

/** organizationId is not given: the repository takes it from the request context. */
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

  /**
   * Unscoped, deliberately -- the one lookup that is: the Stripe webhook that needs it carries no
   * organization (the payment it finds says which one), and a provider session id is globally
   * unique and unguessable.
   */
  findByProviderSessionId(providerSessionId: string): Promise<PaymentEntity | null>;

  /** The invoice's open (pending) session, if any — at most one, by unique index. */
  findOpenByInvoiceId(invoiceId: string): Promise<PaymentEntity | null>;

  /** Whether a payment other than `excludeId` has already been collected for this invoice. */
  hasOtherPaidPayment(invoiceId: string, excludeId: string): Promise<boolean>;

  updateStatus(id: string, status: PaymentStatus): Promise<PaymentEntity | null>;
}
