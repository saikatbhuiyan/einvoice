import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';

describe('InvoiceController', () => {
  let service: jest.Mocked<Pick<InvoiceService, 'create' | 'findAll' | 'findOne' | 'update' | 'remove'>>;
  let controller: InvoiceController;
  const res = { setHeader: jest.fn() } as never;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new InvoiceController(service as never);
  });

  it('delegates create to the service', () => {
    controller.create({ invoiceNumber: 'INV-0001' } as never);
    expect(service.create).toHaveBeenCalledWith({ invoiceNumber: 'INV-0001' });
  });

  it('forwards the response object to findAll for circuit-state headers', () => {
    controller.findAll({ page: 1 } as never, res);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 }, res);
  });

  it('forwards the response object to findOne for circuit-state headers', () => {
    controller.findOne({ id: 'invoice-1' } as never, res);
    expect(service.findOne).toHaveBeenCalledWith('invoice-1', res);
  });

  it('parses the If-Match header into a version on update', () => {
    controller.update({ id: 'invoice-1' } as never, {} as never, '5');
    expect(service.update).toHaveBeenCalledWith('invoice-1', {}, 5);

    controller.update({ id: 'invoice-1' } as never, {} as never, 'garbage');
    expect(service.update).toHaveBeenCalledWith('invoice-1', {}, undefined);
  });

  it('parses the If-Match header into a version on remove', () => {
    controller.remove({ id: 'invoice-1' } as never, '7');
    expect(service.remove).toHaveBeenCalledWith('invoice-1', 7);

    controller.remove({ id: 'invoice-1' } as never, undefined);
    expect(service.remove).toHaveBeenCalledWith('invoice-1', undefined);
  });
});
