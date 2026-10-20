import { Types } from 'mongoose';
import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
import { MissingOrganizationContextError } from '@libs/logging/correlation-context';
import { CustomerRepository } from './customer.repository';

const exec = (result: unknown) => ({ exec: jest.fn().mockResolvedValue(result) });

describe('CustomerRepository', () => {
  let model: { create: jest.Mock; findOne: jest.Mock; findOneAndUpdate: jest.Mock };
  let repository: CustomerRepository;
  const id = new Types.ObjectId().toString();

  beforeEach(() => {
    model = { create: jest.fn(), findOne: jest.fn(() => exec(null)), findOneAndUpdate: jest.fn(() => exec(null)) };
    repository = new CustomerRepository(model as never);
  });

  // RPC payloads skip DTO validation: a payload can't move a customer into another organization.
  it("creates in the caller's organization, keeping only content fields", async () => {
    await repository.create({
      name: 'Acme',
      email: 'billing@acme.test',
      address: '1 Main St',
      organizationId: 'org-other',
      deletedAt: null,
    } as never);

    expect(model.create).toHaveBeenCalledWith({
      name: 'Acme',
      email: 'billing@acme.test',
      address: '1 Main St',
      organizationId: ORG,
    });
  });

  it('looks up, updates and deletes only within the organization, and never a deleted customer', async () => {
    const scoped = { _id: id, organizationId: ORG, deletedAt: null };

    await repository.findOne(id);
    await repository.update(id, { name: 'New', organizationId: 'org-other' } as never);
    await repository.softDelete(id);

    expect(model.findOne).toHaveBeenCalledWith(scoped);
    expect(model.findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      scoped,
      { $set: { name: 'New' } },
      { returnDocument: 'after', runValidators: true },
    );
    expect(model.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      scoped,
      { $set: { deletedAt: expect.any(Date) } },
      {
        returnDocument: 'after',
      },
    );
  });

  it('treats a malformed id as not found without querying', async () => {
    await expect(repository.findOne('nope')).resolves.toBeNull();
    expect(model.findOne).not.toHaveBeenCalled();
  });

  test('refuses outside an organization context', () => {
    expect(() => repository.create({ name: 'Acme' } as never)).toThrow(MissingOrganizationContextError);
  });
});
