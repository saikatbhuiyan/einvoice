import { InvoiceHttpController } from './invoice-http.controller';
import { InvoiceService } from './invoice.service';

describe('InvoiceHttpController', () => {
  let service: jest.Mocked<Pick<InvoiceService, 'create' | 'findAll' | 'findOne' | 'update' | 'remove'>>;
  let controller: InvoiceHttpController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new InvoiceHttpController(service as never);
  });

  it('delegates create to the service', () => {
    controller.create({ invoiceNumber: 'INV-0001' } as never);
    expect(service.create).toHaveBeenCalledWith({ invoiceNumber: 'INV-0001' });
  });

  it('delegates findAll to the service', () => {
    controller.findAll({ page: 1 } as never);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 });
  });

  it('delegates findOne to the service', () => {
    controller.findOne('invoice-1');
    expect(service.findOne).toHaveBeenCalledWith('invoice-1');
  });

  describe('If-Match header parsing on update/remove', () => {
    it('parses a numeric If-Match header into a version', () => {
      controller.update('invoice-1', {} as never, '5');
      expect(service.update).toHaveBeenCalledWith('invoice-1', {}, 5);
    });

    it('treats a missing If-Match header as no version constraint', () => {
      controller.update('invoice-1', {} as never, undefined);
      expect(service.update).toHaveBeenCalledWith('invoice-1', {}, undefined);
    });

    it('treats a non-numeric If-Match header as no version constraint', () => {
      controller.update('invoice-1', {} as never, 'not-a-number');
      expect(service.update).toHaveBeenCalledWith('invoice-1', {}, undefined);
    });

    it('parses If-Match on remove the same way', () => {
      controller.remove('invoice-1', '7');
      expect(service.remove).toHaveBeenCalledWith('invoice-1', 7);

      controller.remove('invoice-1', 'garbage');
      expect(service.remove).toHaveBeenCalledWith('invoice-1', undefined);
    });
  });
});
