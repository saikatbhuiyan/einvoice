import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId } from 'mongoose';
import { CustomerModelName, type CustomerDocument, type CustomerModel } from '@libs/schemas';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { escapeRegExp } from '@libs/shared/utils';
import { requireOrganizationId } from '@libs/logging/correlation-context';
import type { CreateCustomerRequest, FindAllCustomersRequest, UpdateCustomerRequest } from '@libs/interfaces/gateway';

const CONTENT_FIELDS = ['name', 'email', 'address', 'taxId', 'phone', 'bin', 'notes'] as const;

/** The current organization's customers (requireOrganizationId()); others' are "not found". */
@Injectable()
export class CustomerRepository {
  constructor(@InjectModel(CustomerModelName) private readonly model: CustomerModel) {}

  create(data: CreateCustomerRequest): Promise<CustomerDocument> {
    return this.model.create({ ...this.content(data), organizationId: requireOrganizationId() });
  }

  async findAll(query: FindAllCustomersRequest): Promise<{ items: CustomerDocument[]; total: number }> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const filter: Record<string, unknown> = { organizationId: requireOrganizationId(), deletedAt: null };
    const search = query.search ? escapeRegExp(query.search.trim()) : '';
    if (search) {
      filter.$or = ['name', 'email', 'taxId', 'bin'].map((field) => ({ [field]: { $regex: search, $options: 'i' } }));
    }
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ name: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  findOne(id: string): Promise<CustomerDocument | null> {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return this.model.findOne(this.scoped(id)).exec();
  }

  update(id: string, data: UpdateCustomerRequest): Promise<CustomerDocument | null> {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    // runValidators: findOneAndUpdate skips schema validation by default.
    return this.model
      .findOneAndUpdate(this.scoped(id), { $set: this.content(data) }, { returnDocument: 'after', runValidators: true })
      .exec();
  }

  /** Soft delete: issued invoices keep referencing it, and their snapshot stays the legal record. */
  softDelete(id: string): Promise<CustomerDocument | null> {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return this.model
      .findOneAndUpdate(this.scoped(id), { $set: { deletedAt: new Date() } }, { returnDocument: 'after' })
      .exec();
  }

  private scoped(id: string): Record<string, unknown> {
    return { _id: id, organizationId: requireOrganizationId(), deletedAt: null };
  }

  // Allow-listed: RPC payloads skip DTO validation, so organizationId/deletedAt can't ride along.
  private content(data: Partial<CreateCustomerRequest> | UpdateCustomerRequest): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const field of CONTENT_FIELDS) {
      if (data[field] !== undefined) result[field] = data[field];
    }
    return result;
  }
}
