import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentEntity, PaymentStatus } from '../../../database/entities/payment.entity';
import { CreatePaymentRecord, IPaymentRepository } from './payment.repository.interface';

@Injectable()
export class PaymentRepository implements IPaymentRepository {
  constructor(
    @InjectRepository(PaymentEntity)
    private readonly repository: Repository<PaymentEntity>,
  ) {}

  async create(data: CreatePaymentRecord): Promise<PaymentEntity> {
    return this.repository.save(this.repository.create(data));
  }

  async findByProviderSessionId(providerSessionId: string): Promise<PaymentEntity | null> {
    return this.repository.findOne({ where: { providerSessionId } });
  }

  async updateStatus(id: string, status: PaymentStatus): Promise<PaymentEntity | null> {
    await this.repository.update(id, { status });
    return this.repository.findOne({ where: { id } });
  }
}
