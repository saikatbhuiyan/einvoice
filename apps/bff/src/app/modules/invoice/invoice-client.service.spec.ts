import { of } from 'rxjs';
import { TCP_PATTERNS } from '@libs/transports';
import { InvoiceClientService } from './invoice-client.service';

describe('InvoiceClientService', () => {
  let client: { send: jest.Mock };
  let service: InvoiceClientService;

  beforeEach(() => {
    client = { send: jest.fn().mockReturnValue(of({ id: 'invoice-1' })) };
    service = new InvoiceClientService(client as never, undefined);
  });

  const patternOf = (call: jest.Mock) => call.mock.calls[0][0];
  const payloadOf = (call: jest.Mock) => call.mock.calls[0][1].data;

  it('sends CREATE with the invoice payload', async () => {
    await service.createInvoice({ invoiceNumber: 'INV-0001' } as never);

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.INVOICE.CREATE);
    expect(payloadOf(client.send)).toEqual({ invoiceNumber: 'INV-0001' });
  });

  it('sends FIND_ALL with the query', async () => {
    await service.findAllInvoices({ page: 1 } as never);

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.INVOICE.FIND_ALL);
    expect(payloadOf(client.send)).toEqual({ page: 1 });
  });

  it('sends FIND_ONE with the id', async () => {
    await service.findOneInvoice('invoice-1');

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.INVOICE.FIND_ONE);
    expect(payloadOf(client.send)).toEqual({ id: 'invoice-1' });
  });

  it('sends UPDATE with id, data, and version', async () => {
    await service.updateInvoice('invoice-1', { notes: 'hi' }, 3);

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.INVOICE.UPDATE);
    expect(payloadOf(client.send)).toEqual({ id: 'invoice-1', data: { notes: 'hi' }, version: 3 });
  });

  it('sends DELETE with id and version', async () => {
    await service.removeInvoice('invoice-1', 2);

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.INVOICE.DELETE);
    expect(payloadOf(client.send)).toEqual({ id: 'invoice-1', version: 2 });
  });
});
