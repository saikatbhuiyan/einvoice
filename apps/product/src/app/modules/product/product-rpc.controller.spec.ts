import { createRpcEnvelope } from '@libs/transports';
import { FindAllProductsDto } from '@libs/interfaces/gateway';
import { ProductRpcController } from './product-rpc.controller';
import { ProductService } from './product.service';

describe('ProductRpcController', () => {
  let service: jest.Mocked<Pick<ProductService, 'create' | 'findAll'>>;
  let controller: ProductRpcController;

  beforeEach(() => {
    service = { create: jest.fn(), findAll: jest.fn() };
    controller = new ProductRpcController(service as never);
  });

  it('unwraps a raw createByMessage payload', () => {
    controller.createByMessage({ sku: 'SKU-1' } as never);
    expect(service.create).toHaveBeenCalledWith({ sku: 'SKU-1' });
  });

  it('unwraps an envelope-wrapped createByMessage payload', () => {
    const envelope = createRpcEnvelope({ sku: 'SKU-1' }, 'bff');
    controller.createByMessage(envelope as never);
    expect(service.create).toHaveBeenCalledWith({ sku: 'SKU-1' });
  });

  it('defaults findAllByMessage to an empty query when no payload is sent', () => {
    controller.findAllByMessage(undefined as never);
    expect(service.findAll).toHaveBeenCalledWith(new FindAllProductsDto());
  });

  it('unwraps findAllByMessage envelope payloads', () => {
    const envelope = createRpcEnvelope({ page: 2 }, 'bff');
    controller.findAllByMessage(envelope as never);
    expect(service.findAll).toHaveBeenCalledWith({ page: 2 });
  });
});
