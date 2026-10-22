import type { InvoiceItemRequest, ProductResponse } from '@libs/interfaces/gateway';
import { TAX_IDENTITY_CONSTRAINTS, type SupportedCurrency } from '@libs/shared/types';
import { MoneyError, toMinor } from '@libs/money';

/** A line as stored: amounts in minor units; catalog lines carry the product's values. */
export interface StoredLine {
  productId?: string;
  catalogId: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  vatRate: number;
  sdRate: number;
  unit?: string;
}

/** A line the client got wrong: always a 422. */
export class LineItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LineItemError';
  }
}

const CATALOG_FIELDS = ['catalogId', 'name', 'unitPrice', 'vatRate', 'sdRate', 'unit'] as const;

/** The distinct products the lines refer to (one lookup per invoice). */
export function catalogProductIds(items: readonly InvoiceItemRequest[]): string[] {
  return [...new Set(items.flatMap((item) => (item.productId ? [item.productId] : [])))];
}

/**
 * Request lines -> stored lines. A catalog line takes name, SKU, price and rates from its product
 * (which must exist in the caller's organization -- `products` is that organization's -- be active
 * and be priced in the invoice's currency); sending any of those alongside productId is refused,
 * since the product is the source of truth (one-off prices use a free-form line). A free-form line's
 * price is converted to minor units by the currency's exponent.
 *
 * Re-checks everything the gateway DTO checks: RPC payloads skip DTO validation.
 */
export function resolveLines(
  items: readonly InvoiceItemRequest[],
  currency: SupportedCurrency,
  products: ReadonlyMap<string, ProductResponse>,
): StoredLine[] {
  return items.map((item, index) => {
    const where = `items[${index}]`;
    try {
      return item.productId ? catalogLine(item, currency, products, where) : freeFormLine(item, currency, where);
    } catch (error) {
      if (error instanceof MoneyError) throw new LineItemError(`${where}: ${error.message}`);
      throw error;
    }
  });
}

function catalogLine(
  item: InvoiceItemRequest,
  currency: SupportedCurrency,
  products: ReadonlyMap<string, ProductResponse>,
  where: string,
): StoredLine {
  const sent = CATALOG_FIELDS.filter((field) => item[field] !== undefined);
  if (sent.length > 0) {
    throw new LineItemError(
      `${where}: a catalog line takes ${sent.join(', ')} from the product; send only productId and quantity, or a free-form line.`,
    );
  }
  const product = products.get(item.productId as string);
  if (!product) throw new LineItemError(`${where}: product "${item.productId}" was not found.`);
  if (!product.isActive) throw new LineItemError(`${where}: product "${product.sku}" is inactive.`);
  if (product.currency !== currency) {
    throw new LineItemError(
      `${where}: product "${product.sku}" is priced in ${product.currency}, the invoice in ${currency}.`,
    );
  }
  return {
    productId: product.id,
    catalogId: product.sku,
    name: product.name,
    quantity: item.quantity,
    unitPriceMinor: toMinor(product.unitPrice, currency),
    vatRate: product.vatRate,
    sdRate: product.sdRate ?? 0,
    ...(product.unit ? { unit: product.unit } : {}),
  };
}

function freeFormLine(item: InvoiceItemRequest, currency: SupportedCurrency, where: string): StoredLine {
  const missing = (['catalogId', 'name', 'unitPrice', 'vatRate'] as const).filter((field) => item[field] === undefined);
  if (missing.length > 0) throw new LineItemError(`${where}: a free-form line needs ${missing.join(', ')}.`);
  const unit = unitOf(item, where);
  return {
    catalogId: item.catalogId as string,
    name: item.name as string,
    quantity: item.quantity,
    unitPriceMinor: toMinor(item.unitPrice as number, currency),
    vatRate: item.vatRate as number,
    sdRate: item.sdRate ?? 0,
    ...(unit ? { unit } : {}),
  };
}

/** Re-checked here: RPC payloads skip DTO validation. */
function unitOf(item: InvoiceItemRequest, where: string): string | undefined {
  if (item.unit === undefined) return undefined;
  const unit = typeof item.unit === 'string' ? item.unit.trim() : '';
  if (unit.length === 0 || unit.length > TAX_IDENTITY_CONSTRAINTS.unit.maxLength) {
    throw new LineItemError(`${where}: unit must be 1-${TAX_IDENTITY_CONSTRAINTS.unit.maxLength} characters.`);
  }
  return unit;
}
