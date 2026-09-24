import { createRpcEnvelope } from '@libs/transports';
import { InvoiceRpcController } from './invoice-rpc.controller';
import { InvoiceService } from './invoice.service';
import { FindAllInvoicesDto } from '@libs/interfaces/gateway';

describe('InvoiceRpcController', () => {
  let service: jest.Mocked<Pick<InvoiceService, 'create' | 'findAll' | 'findOne' | 'update' | 'remove'>>;
  let controller: InvoiceRpcController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new InvoiceRpcController(service as never);
  });

  it('unwraps a raw createByMessage payload', () => {
    controller.createByMessage({ invoiceNumber: 'INV-0001' } as never);
    expect(service.create).toHaveBeenCalledWith({ invoiceNumber: 'INV-0001' });
  });

  it('unwraps an envelope-wrapped createByMessage payload', () => {
    const envelope = createRpcEnvelope({ invoiceNumber: 'INV-0001' }, 'bff');
    controller.createByMessage(envelope as never);
    expect(service.create).toHaveBeenCalledWith({ invoiceNumber: 'INV-0001' });
  });

  it('defaults findAllByMessage to an empty query when no payload is sent', () => {
    controller.findAllByMessage(undefined as never);
    expect(service.findAll).toHaveBeenCalledWith(new FindAllInvoicesDto());
  });

  it('unwraps findOneByMessage and forwards the id', () => {
    const envelope = createRpcEnvelope({ id: 'invoice-1' }, 'bff');
    controller.findOneByMessage(envelope as never);
    expect(service.findOne).toHaveBeenCalledWith('invoice-1');
  });

  it('unwraps updateByMessage and forwards id/data/version', () => {
    const envelope = createRpcEnvelope({ id: 'invoice-1', data: { notes: 'hi' }, version: 3 }, 'bff');
    controller.updateByMessage(envelope as never);
    expect(service.update).toHaveBeenCalledWith('invoice-1', { notes: 'hi' }, 3);
  });

  it('unwraps removeByMessage and forwards id/version', () => {
    const envelope = createRpcEnvelope({ id: 'invoice-1', version: 2 }, 'bff');
    controller.removeByMessage(envelope as never);
    expect(service.remove).toHaveBeenCalledWith('invoice-1', 2);
  });
});
