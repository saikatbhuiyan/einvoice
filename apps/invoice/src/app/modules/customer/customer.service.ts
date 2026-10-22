import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { buildPaginationMeta } from '@libs/shared/types';
import type { CustomerDocument } from '@libs/schemas';
import type {
  ClientSnapshotRequest,
  CreateCustomerRequest,
  CustomerResponse,
  DeleteCustomerResponse,
  FindAllCustomersRequest,
  FindAllCustomersResponse,
  UpdateCustomerRequest,
} from '@libs/interfaces/gateway';
import { CustomerRepository } from './customer.repository';

const DUPLICATE_KEY = 11000;

@Injectable()
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  async create(data: CreateCustomerRequest): Promise<CustomerResponse> {
    try {
      return this.toResponse(await this.customers.create(data));
    } catch (error) {
      this.rethrow(error, data.email);
    }
  }

  async findAll(query: FindAllCustomersRequest): Promise<FindAllCustomersResponse> {
    const { items, total } = await this.customers.findAll(query);
    return {
      items: items.map((item) => this.toResponse(item)),
      meta: buildPaginationMeta(query.page ?? DEFAULT_PAGE, query.limit ?? DEFAULT_LIMIT, total),
    };
  }

  async findOne(id: string): Promise<CustomerResponse> {
    return this.toResponse(await this.getOrThrow(id));
  }

  async update(id: string, data: UpdateCustomerRequest): Promise<CustomerResponse> {
    try {
      const updated = await this.customers.update(id, data);
      if (!updated) throw this.notFound(id);
      return this.toResponse(updated);
    } catch (error) {
      this.rethrow(error, data.email);
    }
  }

  async remove(id: string): Promise<DeleteCustomerResponse> {
    if (!(await this.customers.softDelete(id))) throw this.notFound(id);
    return { id, deleted: true };
  }

  /**
   * The customer's details as an invoice snapshot. The invoice keeps its own copy: later edits to
   * the customer never change an issued invoice.
   */
  async snapshotOf(id: string): Promise<ClientSnapshotRequest> {
    const customer = await this.getOrThrow(id);
    return {
      name: customer.name,
      email: customer.email,
      address: customer.address,
      ...(customer.phone ? { phone: customer.phone } : {}),
      ...(customer.bin ? { bin: customer.bin } : {}),
    };
  }

  private async getOrThrow(id: string): Promise<CustomerDocument> {
    const customer = await this.customers.findOne(id);
    if (!customer) throw this.notFound(id);
    return customer;
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException(`Customer not found for id "${id}".`);
  }

  private rethrow(error: unknown, email?: string): never {
    if ((error as { code?: unknown })?.code === DUPLICATE_KEY) {
      throw new ConflictException(`A customer with email "${email}" already exists.`);
    }
    if (error instanceof MongooseError.ValidationError) {
      throw new UnprocessableEntityException(
        Object.values(error.errors)
          .map((e) => e.message)
          .join(' '),
      );
    }
    throw error;
  }

  private toResponse(customer: CustomerDocument): CustomerResponse {
    return customer.toJSON() as unknown as CustomerResponse;
  }
}
