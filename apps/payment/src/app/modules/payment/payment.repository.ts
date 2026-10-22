import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { PaymentEntity, PaymentStatus } from '../../../database/entities/payment.entity';
import { requireOrganizationId } from '@libs/logging/correlation-context';
import { CreatePaymentRecord, IPaymentRepository } from './payment.repository.interface';

/** Scoped to the current organization (requireOrganizationId()), except findByProviderSessionId. */
@Injectable()
export class PaymentRepository implements IPaymentRepository {
  constructor(
    @InjectRepository(PaymentEntity)
    private readonly repository: Repository<PaymentEntity>,
  ) {}

  async create(data: CreatePaymentRecord): Promise<PaymentEntity> {
    return this.repository.save(this.repository.create({ ...data, organizationId: requireOrganizationId() }));
  }

  async findByProviderSessionId(providerSessionId: string): Promise<PaymentEntity | null> {
    return this.repository.findOne({ where: { providerSessionId } });
  }

  async findOpenByInvoiceId(invoiceId: string): Promise<PaymentEntity | null> {
    return this.repository.findOne({
      where: { organizationId: requireOrganizationId(), invoiceId, status: 'pending' },
    });
  }

  async hasOtherPaidPayment(invoiceId: string, excludeId: string): Promise<boolean> {
    return this.repository.exists({
      where: { organizationId: requireOrganizationId(), invoiceId, status: 'paid', id: Not(excludeId) },
    });
  }

  async setCheckout(id: string, checkoutUrl: string, expiresAt: Date): Promise<void> {
    await this.repository.update({ id, organizationId: requireOrganizationId() }, { checkoutUrl, expiresAt });
  }

  async updateStatus(id: string, status: PaymentStatus): Promise<PaymentEntity | null> {
    const scope = { id, organizationId: requireOrganizationId() };
    await this.repository.update(scope, { status });
    return this.repository.findOne({ where: scope });
  }
}
