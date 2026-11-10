import type { InvoiceResponse } from '@libs/interfaces/gateway';

/**
 * What is still owed on an invoice. An invoice service from before the payments ledger (mid-rollout)
 * doesn't report balanceDue; nothing could be part-paid then, so the whole total is owed.
 */
export function balanceDueOf(invoice: Pick<InvoiceResponse, 'balanceDue' | 'total'>): number {
  return typeof invoice.balanceDue === 'number' ? invoice.balanceDue : invoice.total;
}
