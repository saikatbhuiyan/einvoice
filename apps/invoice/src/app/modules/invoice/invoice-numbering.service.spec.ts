import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
import { MissingOrganizationContextError } from '@libs/logging/correlation-context';
import { InvoiceNumberingService, formatInvoiceNumber } from './invoice-numbering.service';

const exec = (result: unknown) => ({ exec: jest.fn().mockResolvedValue(result) });

describe('InvoiceNumberingService', () => {
  const session = { id: 'txn' };
  let counters: { updateOne: jest.Mock; findOneAndUpdate: jest.Mock };
  let settings: { current: jest.Mock };
  let service: InvoiceNumberingService;

  beforeEach(() => {
    counters = { updateOne: jest.fn(() => exec({})), findOneAndUpdate: jest.fn() };
    settings = { current: jest.fn().mockResolvedValue({ invoicePrefix: 'ACME', reminderOffsetsDays: [1, 7, 14] }) };
    service = new InvoiceNumberingService(counters as never, settings as never);
  });

  describe('formatInvoiceNumber', () => {
    it.each([
      ['INV', 2026, 1, 'INV-2026-000001'],
      ['ACME', 2027, 123_456, 'ACME-2027-123456'],
      // Past a million the number just grows; it is never truncated into a duplicate.
      ['INV', 2026, 1_000_000, 'INV-2026-1000000'],
    ] as const)('%s / %s / %s -> %s', (prefix, year, sequence, expected) => {
      expect(formatInvoiceNumber(prefix, year, sequence)).toBe(expected);
    });
  });

  describe('prepare', () => {
    // Created outside the transaction: two first-of-the-year issues racing to insert it inside
    // their transactions would fail on the duplicate _id, which is not a retryable error.
    it("ensures the organization's counter for the UTC year of issue exists, without touching its value", async () => {
      await expect(service.prepare(new Date('2026-12-31T23:30:00.000Z'))).resolves.toEqual({
        organizationId: ORG,
        prefix: 'ACME',
        year: 2026,
      });

      expect(counters.updateOne).toHaveBeenCalledWith(
        { _id: `${ORG}:2026` },
        { $setOnInsert: { seq: 0 } },
        { upsert: true },
      );
    });

    it('starts a new sequence in a new year', async () => {
      await service.prepare(new Date('2027-01-01T00:00:00.000Z'));

      expect(counters.updateOne).toHaveBeenCalledWith({ _id: `${ORG}:2027` }, expect.anything(), expect.anything());
    });

    test('refuses outside an organization context', async () => {
      await expect(service.prepare(new Date())).rejects.toBeInstanceOf(MissingOrganizationContextError);
    });
  });

  describe('next', () => {
    const prepared = { organizationId: ORG, prefix: 'ACME', year: 2026 };

    it("increments the counter inside the issuing transaction's session", async () => {
      counters.findOneAndUpdate.mockReturnValue(exec({ seq: 42 }));

      await expect(service.next(prepared, session as never)).resolves.toBe('ACME-2026-000042');
      expect(counters.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: `${ORG}:2026` },
        { $inc: { seq: 1 } },
        { returnDocument: 'after', session },
      );
    });

    it('fails the transaction rather than inventing a number if the counter is missing', async () => {
      counters.findOneAndUpdate.mockReturnValue(exec(null));

      await expect(service.next(prepared, session as never)).rejects.toThrow(/vanished/);
    });
  });
});
