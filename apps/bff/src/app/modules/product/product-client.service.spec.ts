import { of } from 'rxjs';
import { TCP_PATTERNS } from '@libs/transports';
import { ProductClientService } from './product-client.service';

describe('ProductClientService', () => {
  let client: { send: jest.Mock };
  let service: ProductClientService;

  beforeEach(() => {
    client = { send: jest.fn().mockReturnValue(of({ id: 'product-1' })) };
    service = new ProductClientService(client as never, undefined);
  });

  const patternOf = (call: jest.Mock) => call.mock.calls[0][0];
  const payloadOf = (call: jest.Mock) => call.mock.calls[0][1].data;

  it('sends CREATE with the product payload', async () => {
    await service.createProduct({ sku: 'SKU-1' } as never);

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.PRODUCT.CREATE);
    expect(payloadOf(client.send)).toEqual({ sku: 'SKU-1' });
  });

  it('sends FIND_ALL with the query', async () => {
    await service.findAllProducts({ page: 1 } as never);

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.PRODUCT.FIND_ALL);
    expect(payloadOf(client.send)).toEqual({ page: 1 });
  });
});
