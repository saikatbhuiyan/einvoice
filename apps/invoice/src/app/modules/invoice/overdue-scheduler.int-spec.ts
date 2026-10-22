import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';
import mongoose, { type Connection } from 'mongoose';
import {
  AuditLogModelName,
  AuditLogSchema,
  InvoiceModelName,
  InvoiceSchema,
  OutboxEventModelName,
  OutboxEventSchema,
  type InvoiceModel,
  type OutboxEventModel,
} from '@libs/schemas';
import { AuditLogService } from '@libs/audit-log';
import { getCurrentCorrelationContext, requireOrganizationId } from '@libs/logging/correlation-context';
import { syncOwnedIndexes } from '../../../database/index-sync';
import { OutboxRepository } from '../outbox/outbox.repository';
import { InvoiceEventsProducerService } from './clients/invoice-events-producer.service';
import { InvoiceRepository } from './invoice.repository';
import { InvoiceService } from './invoice.service';
import { OverdueScheduler, type OverdueSchedulerOptions } from './overdue-scheduler.service';

/**
 * Integration test: the overdue scheduler end to end on real MongoDB (replica set: transactions)
 * and real Redis (the lease) -- the real scheduler, service, repository, outbox and audit log. Only
 * the PDF renderer and S3 are stubbed, and those stubs record the context they were called in.
 */
const ORG_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ORG_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const OPTIONS: OverdueSchedulerOptions = { intervalMs: 3_600_000, batchSize: 100, leaseMs: 60_000 };

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const at = (iso: string) => new Date(iso);

describe('overdue scheduler against real MongoDB and Redis', () => {
  let mongo: StartedMongoDBContainer;
  let redisContainer: StartedRedisContainer;
  let connection: Connection;
  let redis: Redis;
  let invoices: InvoiceModel;
  let outbox: OutboxEventModel;
  let service: InvoiceService;
  let schedules: Record<string, number[]>;
  let renderContexts: unknown[];
  const schedulers: OverdueScheduler[] = [];

  beforeAll(async () => {
    [mongo, redisContainer] = await Promise.all([
      new MongoDBContainer('mongo:7').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    connection = await mongoose
      .createConnection(mongo.getConnectionString(), { directConnection: true, dbName: 'overdue_int' })
      .asPromise();
    redis = new Redis(redisContainer.getConnectionUrl());
    invoices = connection.model(InvoiceModelName, InvoiceSchema) as unknown as InvoiceModel;
    outbox = connection.model(OutboxEventModelName, OutboxEventSchema) as unknown as OutboxEventModel;
    connection.model(AuditLogModelName, AuditLogSchema);
    await syncOwnedIndexes(connection);

    const repository = new InvoiceRepository(invoices, invoices);
    const noCache = { get: async () => undefined, set: async () => undefined, del: async () => undefined };
    const settings = {
      current: async () => ({
        invoicePrefix: 'INV',
        reminderOffsetsDays: schedules[requireOrganizationId()] ?? [1, 7, 14],
      }),
    };
    // A render records who asked: it must be the system, in the invoice's organization.
    const pdfGenerator = {
      generateInvoicePdf: async () => {
        const context = getCurrentCorrelationContext();
        renderContexts.push({
          actor: context?.systemActor,
          organizationId: context?.organizationId,
          permissions: context?.permissions,
        });
        return { base64: 'JVBERg==', contentType: 'application/pdf', fileName: 'invoice-rendered.pdf' };
      },
    };
    const media = {
      uploadFile: async () => ({ key: `orgs/${requireOrganizationId()}/invoices/r/invoice-rendered.pdf` }),
    };

    service = new InvoiceService(
      repository,
      noCache as never,
      redis,
      new AuditLogService(connection.model(AuditLogModelName) as never),
      pdfGenerator as never,
      media as never,
      new InvoiceEventsProducerService(new OutboxRepository(outbox)),
      {} as never,
      {} as never,
      settings as never,
      {} as never,
    );
  });

  const newScheduler = () => {
    const scheduler = new OverdueScheduler(new InvoiceRepository(invoices, invoices), service, redis, OPTIONS);
    schedulers.push(scheduler);
    return scheduler;
  };

  afterEach(async () => {
    await Promise.all(schedulers.splice(0).map((scheduler) => scheduler.onApplicationShutdown()));
  });

  afterAll(async () => {
    await redis?.quit();
    await connection?.close();
    await Promise.all([mongo?.stop(), redisContainer?.stop()]);
  });

  beforeEach(async () => {
    schedules = {};
    renderContexts = [];
    await Promise.all([
      invoices.deleteMany({}),
      outbox.deleteMany({}),
      connection.model(AuditLogModelName).deleteMany({}),
      redis.flushall(),
    ]);
  });

  let n = 0;
  const seed = async (fields: { organizationId?: string; status?: string; dueDate?: Date; pdfKey?: string | null }) => {
    const [invoice] = await invoices.create([
      {
        organizationId: ORG_A,
        status: 'issued',
        invoiceNumber: `INV-2026-${String(++n).padStart(6, '0')}`,
        issueDate: day('2026-09-01'),
        client: { name: 'Acme Corp', email: 'ap@acme.test', address: '1 Main St' },
        items: [{ catalogId: 'S', name: 'Work', quantity: 1, unitPriceMinor: 10_000, vatRate: 0 }],
        currency: 'USD',
        pdfKey: 'orgs/a/invoices/u/invoice.pdf',
        ...fields,
      },
    ]);
    return invoice.id as string;
  };
  const stored = (id: string) => invoices.findById(id).lean();
  const reminderEvents = () => outbox.find({ 'value.data.type': 'invoice.reminder' }).sort({ _id: 1 }).lean();

  it('marks issued invoices overdue the day after their due date, in their own organization', async () => {
    const pastA = await seed({ dueDate: day('2026-10-10') });
    const pastB = await seed({ organizationId: ORG_B, dueDate: day('2026-10-10') });
    const dueToday = await seed({ dueDate: day('2026-10-11') });
    const noDueDate = await seed({});
    const draft = await seed({ status: 'draft', invoiceNumber: undefined, dueDate: day('2026-10-01') } as never);

    await expect(newScheduler().tick(at('2026-10-11T00:05:00Z'))).resolves.toMatchObject({ marked: 2, failed: 0 });

    expect((await stored(pastA))?.status).toBe('overdue');
    expect((await stored(pastB))?.status).toBe('overdue');
    expect((await stored(dueToday))?.status).toBe('issued');
    expect((await stored(noDueDate))?.status).toBe('issued');
    expect((await stored(draft))?.status).toBe('draft');

    const audit = await connection.model(AuditLogModelName).find({ action: 'STATUS_CHANGE' }).lean();
    expect(audit.map((entry) => [entry['organizationId'], entry['actor']]).sort()).toEqual([
      [ORG_A, 'system:overdue-job'],
      [ORG_B, 'system:overdue-job'],
    ]);
  });

  it('sends each scheduled reminder once, through the outbox, on the organization schedule', async () => {
    schedules[ORG_A] = [1, 7];
    const id = await seed({ dueDate: day('2026-10-10') });
    const scheduler = newScheduler();

    await expect(scheduler.tick(at('2026-10-11T00:05:00Z'))).resolves.toMatchObject({ marked: 1, reminded: 1 });
    await expect(scheduler.tick(at('2026-10-11T06:00:00Z'))).resolves.toMatchObject({ reminded: 0 });
    expect(await stored(id)).toMatchObject({ remindersSent: 1, nextReminderAt: day('2026-10-17') });

    await expect(scheduler.tick(at('2026-10-17T00:05:00Z'))).resolves.toMatchObject({ reminded: 1 });
    expect(await stored(id)).toMatchObject({ remindersSent: 2, nextReminderAt: null });
    await expect(scheduler.tick(at('2026-10-30T00:05:00Z'))).resolves.toMatchObject({ reminded: 0 });

    const events = await reminderEvents();
    expect(events.map((event) => event.value['data'])).toEqual([
      expect.objectContaining({ invoiceId: id, reminderNumber: 1, daysOverdue: 1 }),
      expect.objectContaining({ invoiceId: id, reminderNumber: 2, daysOverdue: 7 }),
    ]);
    expect(events[0].value['meta']).toMatchObject({ systemActor: 'overdue-job', organizationId: ORG_A });
    expect(events[0].value['meta']).not.toHaveProperty('userId');
  });

  it('sends nothing for an organization that turned reminders off', async () => {
    schedules[ORG_B] = [];
    const id = await seed({ organizationId: ORG_B, dueDate: day('2026-10-10') });

    await expect(newScheduler().tick(at('2026-10-11T00:05:00Z'))).resolves.toMatchObject({ marked: 1, reminded: 0 });
    expect(await stored(id)).toMatchObject({ status: 'overdue', nextReminderAt: null });
  });

  // Rollout safety: old unpaid invoices found late don't trigger a burst of emails.
  it('never sends a reminder more than a day late', async () => {
    const monthLate = await seed({ dueDate: day('2026-09-10') });
    const threeDaysLate = await seed({ dueDate: day('2026-10-08') });

    await expect(newScheduler().tick(at('2026-10-11T09:00:00Z'))).resolves.toMatchObject({ marked: 2, reminded: 0 });

    expect(await stored(monthLate)).toMatchObject({ status: 'overdue', nextReminderAt: null });
    expect(await stored(threeDaysLate)).toMatchObject({ nextReminderAt: day('2026-10-15') }); // day 7, not day 1
    expect(await reminderEvents()).toHaveLength(0);
  });

  it('stops reminding once the invoice is paid', async () => {
    const id = await seed({ dueDate: day('2026-10-10') });
    const scheduler = newScheduler();
    await scheduler.tick(at('2026-10-11T00:05:00Z'));
    await invoices.updateOne({ _id: id }, { $set: { status: 'paid' } });

    await expect(scheduler.tick(at('2026-10-17T00:05:00Z'))).resolves.toMatchObject({ reminded: 0 });
    expect(await reminderEvents()).toHaveLength(1);
  });

  it('renders a missing PDF as the system, in the invoice organization, before reminding', async () => {
    const id = await seed({ organizationId: ORG_B, dueDate: day('2026-10-10'), pdfKey: null });

    await expect(newScheduler().tick(at('2026-10-11T00:05:00Z'))).resolves.toMatchObject({ reminded: 1, failed: 0 });

    expect(renderContexts).toEqual([
      { actor: 'overdue-job', organizationId: ORG_B, permissions: ['invoice:read', 'invoice:write'] },
    ]);
    const key = `orgs/${ORG_B}/invoices/r/invoice-rendered.pdf`;
    expect((await stored(id))?.pdfKey).toBe(key);
    expect((await reminderEvents())[0].value['data']).toMatchObject({ pdfKey: key, fileName: 'invoice-rendered.pdf' });
  });

  it('lets only the lease holder work', async () => {
    await seed({ dueDate: day('2026-10-10') });
    const now = at('2026-10-11T00:05:00Z');

    const [first, second] = await Promise.all([newScheduler().tick(now), newScheduler().tick(now)]);

    expect(first.marked + second.marked).toBe(1);
    expect([first.marked + first.reminded, second.marked + second.reminded].sort()).toEqual([0, 2]);
  });

  // The lease isn't what makes it correct: overlapping passes (e.g. a lapsed lease) still send once.
  it('sends each reminder once even when two passes overlap', async () => {
    const ids = await Promise.all([1, 2, 3].map(() => seed({ dueDate: day('2026-10-10') })));
    const now = at('2026-10-11T00:05:00Z');
    const alwaysLeader = { eval: async () => 1 } as unknown as Redis;
    const overlapping = [1, 2].map(
      () => new OverdueScheduler(new InvoiceRepository(invoices, invoices), service, alwaysLeader, OPTIONS),
    );

    await Promise.all(overlapping.map((scheduler) => scheduler.tick(now)));
    await Promise.all(overlapping.map((scheduler) => scheduler.tick(now)));

    const events = await reminderEvents();
    expect(events.map((event) => event.value['data']['invoiceId']).sort()).toEqual([...ids].sort());
    for (const id of ids) expect((await stored(id))?.remindersSent).toBe(1);
  });
});
