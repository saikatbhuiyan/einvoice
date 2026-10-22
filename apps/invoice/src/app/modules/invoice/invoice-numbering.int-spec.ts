import { UnprocessableEntityException } from '@nestjs/common';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import mongoose, { type Connection } from 'mongoose';
import {
  InvoiceCounterModelName,
  InvoiceCounterSchema,
  InvoiceModelName,
  InvoiceSchema,
  type InvoiceCounterModel,
  type InvoiceModel,
} from '@libs/schemas';
import { runWithCorrelationContext } from '@libs/logging/correlation-context';
import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
import { syncOwnedIndexes } from '../../../database/index-sync';
import { InvoiceRepository } from './invoice.repository';
import type { NewInvoice } from './invoice.repository.interface';
import { InvoiceNumberingService } from './invoice-numbering.service';
import { InvoiceService } from './invoice.service';

/**
 * Integration test: gapless per-organization numbering through the real InvoiceService,
 * InvoiceRepository and InvoiceNumberingService on a real MongoDB replica set. Only what sits
 * outside Mongo (cache, peers, events) is stubbed. What only a real database shows: that a number
 * taken by an aborted transaction is given back, and that concurrent issues serialize on the
 * counter instead of sharing or skipping a number.
 */
// What user-access answers for the organization; a test may change it before issuing.
const UTC_ORGANIZATION = {
  invoicePrefix: 'ACME',
  reminderOffsetsDays: [1, 7, 14],
  timeZone: 'UTC',
  issuer: { name: 'Acme Ltd.', bin: null as string | null, address: null as string | null, authorizedSignatory: null },
};
let organization = { ...UTC_ORGANIZATION };

describe('invoice numbering against real MongoDB', () => {
  let container: StartedMongoDBContainer;
  let connection: Connection;
  let invoices: InvoiceModel;
  let counters: InvoiceCounterModel;
  let repository: InvoiceRepository;
  let numbering: InvoiceNumberingService;
  let service: InvoiceService;
  const year = new Date().getUTCFullYear();

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:7').start();
    connection = await mongoose
      .createConnection(container.getConnectionString(), { directConnection: true, dbName: 'numbering_int' })
      .asPromise();
    invoices = connection.model(InvoiceModelName, InvoiceSchema) as unknown as InvoiceModel;
    counters = connection.model(InvoiceCounterModelName, InvoiceCounterSchema) as unknown as InvoiceCounterModel;
    // The deploy step production runs (autoIndex is off there); builds the per-org unique index.
    await syncOwnedIndexes(connection);

    repository = new InvoiceRepository(invoices, invoices);
    const noCache = { get: async () => undefined, set: async () => undefined, del: async () => undefined };
    const settings = { current: async () => ({ ...organization }) };
    numbering = new InvoiceNumberingService(counters, settings as never);
    service = new InvoiceService(
      repository,
      noCache as never,
      { get: async () => null, incr: async () => 1 } as never,
      { record: async () => undefined } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      numbering,
      settings as never,
      { findMany: async () => [] } as never,
    );
  });

  afterAll(async () => {
    await connection?.close();
    await container?.stop();
  });

  beforeEach(() => {
    organization = { ...UTC_ORGANIZATION };
    return Promise.all([invoices.deleteMany({}), counters.deleteMany({})]);
  });

  const draft = (overrides: Partial<NewInvoice> = {}) =>
    repository.create({
      client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Main St' },
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPriceMinor: 10_000, vatRate: 0, sdRate: 0 }],
      currency: 'USD',
      ...overrides,
    } as NewInvoice);
  const number = (seq: number) => `ACME-${year}-${String(seq).padStart(6, '0')}`;
  const counterValue = async (organizationId = ORG) =>
    (await counters.findById(`${organizationId}:${year}`).lean())?.seq;

  it('numbers issued invoices in sequence and dates them at the moment of issue', async () => {
    const before = Date.now();
    const issued = [];
    for (let i = 0; i < 3; i++) issued.push(await service.issue((await draft()).id));

    expect(issued.map((invoice) => invoice.invoiceNumber)).toEqual([number(1), number(2), number(3)]);
    expect(new Date(issued[0].issueDate).getTime()).toBeGreaterThanOrEqual(before);
    expect(await counterValue()).toBe(3);
  });

  // The point of incrementing inside the issuing transaction.
  it('gives the number back when the issuing transaction aborts after taking it', async () => {
    const first = await draft();
    const prepared = await numbering.prepare(new Date());

    await expect(
      repository.transitionStatus(first.id, ['draft'], 'issued', {
        prepare: async (_current, session) => ({ invoiceNumber: await numbering.next(prepared, session) }),
        inTransaction: async () => {
          throw new Error('crash after the number was taken');
        },
      }),
    ).rejects.toThrow('crash after the number was taken');

    expect(await counterValue()).toBe(0);
    expect(await invoices.findById(first.id).lean()).toMatchObject({ status: 'draft' });
    expect((await service.issue(first.id)).invoiceNumber).toBe(number(1));
  });

  it('gives concurrent issues distinct, consecutive numbers -- no duplicates, no gaps', async () => {
    const drafts = await Promise.all(Array.from({ length: 10 }, () => draft()));

    const issued = await Promise.all(drafts.map((invoice) => service.issue(invoice.id)));

    expect(issued.map((invoice) => invoice.invoiceNumber).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => number(i + 1)),
    );
    expect(await counterValue()).toBe(10);
  });

  it('keeps an independent sequence per organization', async () => {
    await service.issue((await draft()).id);
    const theirs = await runWithCorrelationContext(
      { correlationId: 'int', traceId: 'int', organizationId: 'org-other' },
      async () => service.issue((await draft()).id),
    );

    expect(theirs.invoiceNumber).toBe(number(1));
    expect(await counterValue('org-other')).toBe(1);
  });

  // Requesting the status the invoice already has is a no-op, so a retried issue keeps its number.
  it('does not take a new number when an issued invoice is issued again', async () => {
    const invoice = await draft();
    await service.issue(invoice.id);

    await expect(service.issue(invoice.id)).resolves.toMatchObject({ invoiceNumber: number(1) });
    expect(await counterValue()).toBe(1);
  });

  it('refuses a draft whose due date has passed without consuming a number', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const lapsed = await draft({
      issueDate: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      dueDate: yesterday.toISOString(),
    });

    await expect(service.issue(lapsed.id)).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(await counterValue()).toBe(0);
    expect(await invoices.findById(lapsed.id).lean()).toMatchObject({ status: 'draft' });
    expect((await service.issue((await draft()).id)).invoiceNumber).toBe(number(1));
  });

  // A tax invoice keeps saying what it said: the issuer is stored on the invoice, through the real schema.
  it('stores the seller as of the moment of issue, and keeps it when the organization changes', async () => {
    organization = {
      ...UTC_ORGANIZATION,
      timeZone: 'Asia/Dhaka',
      issuer: {
        name: 'Acme Ltd.',
        bin: '0012345670101',
        address: 'House 12, Road 8, Dhaka',
        authorizedSignatory: { name: 'Rahim Uddin', designation: 'Accounts Manager' } as never,
      },
    };
    const issued = await service.issue((await draft({ currency: 'BDT' })).id);

    organization = { ...UTC_ORGANIZATION, issuer: { ...UTC_ORGANIZATION.issuer, name: 'Renamed Ltd.' } };
    const stored = await invoices.findById(issued.id).orFail();

    expect(stored.toObject().seller).toEqual({
      name: 'Acme Ltd.',
      bin: '0012345670101',
      address: 'House 12, Road 8, Dhaka',
      authorizedSignatory: { name: 'Rahim Uddin', designation: 'Accounts Manager' },
      timeZone: 'Asia/Dhaka',
    });
    expect(issued.seller).toMatchObject({ bin: '0012345670101', timeZone: 'Asia/Dhaka' });
    await expect(stored.validate()).resolves.toBeUndefined();
  });
});
