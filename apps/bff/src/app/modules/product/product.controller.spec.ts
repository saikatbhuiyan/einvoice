import { ProductController } from './product.controller';
import { ProductService } from './product.service';

describe('ProductController', () => {
  let service: jest.Mocked<Pick<ProductService, 'create' | 'findAll'>>;
  let controller: ProductController;
  const res = { setHeader: jest.fn() } as never;

  beforeEach(() => {
    service = { create: jest.fn(), findAll: jest.fn() };
    controller = new ProductController(service as never);
  });

  it('delegates create to the service', () => {
    controller.create({ sku: 'SKU-1' } as never);
    expect(service.create).toHaveBeenCalledWith({ sku: 'SKU-1' });
  });

  it('forwards the response object to findAll for circuit-state headers', () => {
    controller.findAll({ page: 1 } as never, res);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 }, res);
  });
});
