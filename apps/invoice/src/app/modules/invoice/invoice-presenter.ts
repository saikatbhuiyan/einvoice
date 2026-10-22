import type { InvoiceItemResponse, InvoiceResponse } from '@libs/interfaces/gateway';
import type { SupportedCurrency } from '@libs/shared/types';
import { fromMinor } from '@libs/money';

interface StoredItemJson {
  productId?: string;
  catalogId: string;
  name: string;
  unit?: string;
  quantity: number;
  unitPriceMinor: number;
  vatRate: number;
  sdRate?: number;
  netMinor: number;
  sdMinor?: number;
  vatMinor: number;
  totalMinor: number;
}

type StoredInvoiceJson = Omit<InvoiceResponse, 'items' | 'subtotal' | 'sdTotal' | 'vatTotal' | 'total'> & {
  items: StoredItemJson[];
  netMinor: number;
  sdMinor?: number;
  vatMinor: number;
  totalMinor: number;
};

/**
 * Stored invoice (exact minor units) -> the API's unchanged decimal shape. The one place money
 * leaves the service as decimals: every response goes through here.
 */
export function presentInvoice(json: unknown): InvoiceResponse {
  const { items, netMinor, sdMinor, vatMinor, totalMinor, ...rest } = json as StoredInvoiceJson;
  const currency = rest.currency as SupportedCurrency;
  const amount = (minor: number | undefined) => fromMinor(minor ?? 0, currency);

  return {
    ...rest,
    items: items.map(
      (item): InvoiceItemResponse => ({
        ...(item.productId ? { productId: item.productId } : {}),
        catalogId: item.catalogId,
        name: item.name,
        ...(item.unit ? { unit: item.unit } : {}),
        quantity: item.quantity,
        unitPrice: amount(item.unitPriceMinor),
        vatRate: item.vatRate,
        sdRate: item.sdRate ?? 0,
        net: amount(item.netMinor),
        sd: amount(item.sdMinor),
        vat: amount(item.vatMinor),
        total: amount(item.totalMinor),
      }),
    ),
    subtotal: amount(netMinor),
    sdTotal: amount(sdMinor),
    vatTotal: amount(vatMinor),
    total: amount(totalMinor),
  };
}
