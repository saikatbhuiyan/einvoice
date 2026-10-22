import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomerService } from './customer.service';

const customerDoc = (fields: Record<string, unknown>) => ({ ...fields, toJSON: () => fields });

describe('CustomerService', () => {
  let repository: {
    create: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
  };
  let service: CustomerService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    service = new CustomerService(repository as never);
  });

  // A registered buyer's BIN is "BIN of Purchaser" on the Mushak-6.3: it travels with the snapshot.
  it("snapshots a customer's BIN", async () => {
    repository.findOne.mockResolvedValue(
      customerDoc({ name: 'Acme', email: 'billing@acme.test', address: '1 Main St', bin: '0098765430202' }),
    );

    await expect(service.snapshotOf('cust-1')).resolves.toEqual({
      name: 'Acme',
      email: 'billing@acme.test',
      address: '1 Main St',
      bin: '0098765430202',
    });
  });

  it('snapshots only the fields an invoice keeps', async () => {
    repository.findOne.mockResolvedValue(
      customerDoc({ name: 'Acme', email: 'billing@acme.test', address: '1 Main St', taxId: 'DE123', notes: 'vip' }),
    );

    await expect(service.snapshotOf('cust-1')).resolves.toEqual({
      name: 'Acme',
      email: 'billing@acme.test',
      address: '1 Main St',
    });
  });

  // The repository scopes by organization, so another tenant's customer is simply not found.
  it('is a 404 for a customer the repository does not find', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.snapshotOf('cust-x')).rejects.toThrow(
      new NotFoundException('Customer not found for id "cust-x".'),
    );
  });

  it.each([
    ['create', () => service.create({ name: 'Acme', email: 'dup@acme.test', address: '1 Main St' })],
    ['update', () => service.update('cust-1', { email: 'dup@acme.test' })],
  ])('maps a duplicate email on %s to a 409', async (method, call) => {
    repository[method as 'create' | 'update'].mockRejectedValue({ code: 11000 });

    await expect(call()).rejects.toThrow(
      new ConflictException('A customer with email "dup@acme.test" already exists.'),
    );
  });

  it('is a 404 when updating or deleting a customer that is not there', async () => {
    repository.update.mockResolvedValue(null);
    repository.softDelete.mockResolvedValue(null);

    await expect(service.update('cust-x', { name: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('cust-x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists with offset pagination metadata', async () => {
    repository.findAll.mockResolvedValue({ items: [customerDoc({ id: 'c1' })], total: 21 });

    await expect(service.findAll({ page: 2, limit: 10 })).resolves.toEqual({
      items: [{ id: 'c1' }],
      meta: expect.objectContaining({ page: 2, limit: 10, total: 21, totalPages: 3 }),
    });
  });
});
