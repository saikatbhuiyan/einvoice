import { NotFoundException } from '@nestjs/common';
import { CustomerController } from './customer.controller';

describe('CustomerController', () => {
  const ID = '662f9d38f2ab7c001f52c9aa';
  let client: { findOneCustomer: jest.Mock };
  let invoices: { findAll: jest.Mock };
  let controller: CustomerController;

  beforeEach(() => {
    client = { findOneCustomer: jest.fn().mockResolvedValue({ id: ID }) };
    invoices = { findAll: jest.fn().mockResolvedValue({ items: [] }) };
    controller = new CustomerController(client as never, invoices as never);
  });

  describe('GET /customers/:id/invoices', () => {
    it("lists through the invoice listing, filtered to the customer from the path (not the query's)", async () => {
      const res = {} as never;

      await controller.findInvoices({ id: ID }, { limit: 20, status: 'issued', customerId: 'someone-else' }, res);

      expect(invoices.findAll).toHaveBeenCalledWith({ limit: 20, status: 'issued', customerId: ID }, res);
    });

    // Otherwise another organization's customer id would look like a customer with no invoices.
    it('is a 404 for a customer not in the active organization, without listing anything', async () => {
      client.findOneCustomer.mockRejectedValue(new NotFoundException(`Customer not found for id "${ID}".`));

      await expect(controller.findInvoices({ id: ID }, { limit: 20 }, {} as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(invoices.findAll).not.toHaveBeenCalled();
    });
  });
});
