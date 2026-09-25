import { ProductHttpController } from './product-http.controller';
import { ProductService } from './product.service';

describe('ProductHttpController', () => {
  let service: jest.Mocked<Pick<ProductService, 'create' | 'findAll'>>;
  let controller: ProductHttpController;

  beforeEach(() => {
    service = { create: jest.fn(), findAll: jest.fn() };
    controller = new ProductHttpController(service as never);
  });

  it('delegates create to the service', () => {
    controller.create({ sku: 'SKU-1' } as never);
    expect(service.create).toHaveBeenCalledWith({ sku: 'SKU-1' });
  });

  it('delegates findAll to the service', () => {
    controller.findAll({ page: 1 } as never);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 });
  });
});
