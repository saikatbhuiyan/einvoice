import type { ProductResponse } from '@libs/interfaces/gateway';
import { LineItemError, catalogProductIds, resolveLines } from './line-items';

const PRODUCT: ProductResponse = {
  id: '5f1d7c1e-2b9a-4c64-9a7e-3f1c2d4b5a6e',
  sku: 'SKU-CIG',
  name: 'Cigarettes (carton)',
  unitPrice: 1500.5,
  currency: 'BDT',
  vatRate: 15,
  sdRate: 65,
  isActive: true,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
};
const products = new Map([[PRODUCT.id, PRODUCT]]);

describe('resolveLines', () => {
  it('fills a catalog line from the product, in minor units', () => {
    expect(resolveLines([{ productId: PRODUCT.id, quantity: 2 }], 'BDT', products)).toEqual([
      {
        productId: PRODUCT.id,
        catalogId: 'SKU-CIG',
        name: 'Cigarettes (carton)',
        quantity: 2,
        unitPriceMinor: 150050,
        vatRate: 15,
        sdRate: 65,
      },
    ]);
  });

  it('converts a free-form line, SD defaulting to 0', () => {
    expect(
      resolveLines([{ catalogId: 'X', name: 'Work', quantity: 1.5, unitPrice: 33.33, vatRate: 7.5 }], 'USD', new Map()),
    ).toEqual([{ catalogId: 'X', name: 'Work', quantity: 1.5, unitPriceMinor: 3333, vatRate: 7.5, sdRate: 0 }]);
  });

  it.each([
    [
      'sends product fields with productId (no overrides)',
      [{ productId: PRODUCT.id, quantity: 1, unitPrice: 1 }],
      'BDT',
      /takes unitPrice from the product/,
    ],
    ['names a product that is not in the organization', [{ productId: 'nope', quantity: 1 }], 'BDT', /not found/],
    [
      'prices it in another currency',
      [{ productId: PRODUCT.id, quantity: 1 }],
      'USD',
      /priced in BDT, the invoice in USD/,
    ],
    ['is a free-form line missing fields', [{ catalogId: 'X', quantity: 1 }], 'BDT', /needs name, unitPrice, vatRate/],
    [
      'has more decimals than the currency',
      [{ catalogId: 'X', name: 'W', quantity: 1, unitPrice: 1.005, vatRate: 0 }],
      'BDT',
      /items\[0\]: .*decimal places/,
    ],
  ] as const)('refuses a line that %s', (_label, items, currency, message) => {
    expect(() => resolveLines(items as never, currency, products)).toThrow(LineItemError);
    expect(() => resolveLines(items as never, currency, products)).toThrow(message);
  });

  it('refuses an inactive product', () => {
    const inactive = new Map([[PRODUCT.id, { ...PRODUCT, isActive: false }]]);

    expect(() => resolveLines([{ productId: PRODUCT.id, quantity: 1 }], 'BDT', inactive)).toThrow(/inactive/);
  });

  it('looks up each product once', () => {
    expect(
      catalogProductIds([
        { productId: 'a', quantity: 1 },
        { productId: 'a', quantity: 2 },
        { catalogId: 'x', name: 'n', quantity: 1, unitPrice: 1, vatRate: 0 },
      ]),
    ).toEqual(['a']);
  });
});
