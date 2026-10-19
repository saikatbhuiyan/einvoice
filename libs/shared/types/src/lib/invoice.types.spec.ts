import { INVOICE_STATUSES, canTransition, statusesTransitionableTo, type InvoiceStatus } from './invoice.types';

describe('invoice status transitions', () => {
  const allowed: Array<[InvoiceStatus, InvoiceStatus]> = [
    ['draft', 'issued'],
    ['issued', 'paid'],
    ['issued', 'overdue'],
    ['issued', 'cancelled'],
    ['overdue', 'paid'],
    ['overdue', 'cancelled'],
  ];

  const isAllowed = (from: InvoiceStatus, to: InvoiceStatus) =>
    allowed.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to);

  // Every (from, to) pair, so a transition added to the table without updating this list fails.
  const everyPair = INVOICE_STATUSES.flatMap((from) => INVOICE_STATUSES.map((to) => [from, to] as const));

  it.each(everyPair)('%s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(isAllowed(from, to));
  });

  it('treats paid and cancelled as terminal', () => {
    for (const to of INVOICE_STATUSES) {
      expect(canTransition('paid', to)).toBe(false);
      expect(canTransition('cancelled', to)).toBe(false);
    }
  });

  it('lists the source statuses for a target', () => {
    expect(statusesTransitionableTo('paid')).toEqual(['issued', 'overdue']);
    expect(statusesTransitionableTo('cancelled')).toEqual(['issued', 'overdue']);
    expect(statusesTransitionableTo('issued')).toEqual(['draft']);
    expect(statusesTransitionableTo('draft')).toEqual([]);
  });
});
