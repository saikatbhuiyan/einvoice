import type Redis from 'ioredis';
import { getCurrentCorrelationContext } from '@libs/logging/correlation-context';
import {
  OverdueScheduler,
  overdueSchedulerOptionsFromEnv,
  type OverdueSchedulerOptions,
} from './overdue-scheduler.service';

const OPTIONS: OverdueSchedulerOptions = { intervalMs: 60_000, batchSize: 2, leaseMs: 60_000 };
const NOW = new Date('2026-10-11T00:05:00.000Z');

describe('OverdueScheduler', () => {
  let invoices: { findPastDueIssued: jest.Mock; findDueReminders: jest.Mock };
  let service: { markOverdue: jest.Mock; sendDueReminder: jest.Mock };
  let redis: { eval: jest.Mock };
  let scheduler: OverdueScheduler;

  beforeEach(() => {
    invoices = {
      findPastDueIssued: jest.fn().mockResolvedValue([]),
      findDueReminders: jest.fn().mockResolvedValue([]),
    };
    service = { markOverdue: jest.fn().mockResolvedValue(true), sendDueReminder: jest.fn().mockResolvedValue('sent') };
    redis = { eval: jest.fn().mockResolvedValue(1) }; // holds the lease
    scheduler = new OverdueScheduler(invoices as never, service as never, redis as unknown as Redis, OPTIONS);
  });

  afterEach(() => scheduler.onApplicationShutdown());

  it('does nothing unless it holds the leader lease', async () => {
    redis.eval.mockResolvedValue(0);

    await expect(scheduler.tick(NOW)).resolves.toMatchObject({ marked: 0, reminded: 0 });
    expect(invoices.findPastDueIssued).not.toHaveBeenCalled();
  });

  it('marks invoices whose due date is before today (UTC), then sends due reminders', async () => {
    invoices.findPastDueIssued.mockResolvedValue([{ id: 'a', organizationId: 'org-1' }]);
    invoices.findDueReminders.mockResolvedValue([{ id: 'b', organizationId: 'org-2' }]);

    await expect(scheduler.tick(NOW)).resolves.toMatchObject({ marked: 1, reminded: 1, failed: 0 });

    expect(invoices.findPastDueIssued).toHaveBeenCalledWith(new Date('2026-10-11T00:00:00.000Z'), 2);
    expect(invoices.findDueReminders).toHaveBeenCalledWith(NOW, 2);
    expect(service.markOverdue).toHaveBeenCalledWith('a', NOW);
    expect(service.sendDueReminder).toHaveBeenCalledWith('b', NOW);
  });

  // Everything downstream (queries, cache keys, audit, PDF rendering) is scoped by this context.
  it("handles each invoice as the system, in that invoice's organization, with only the job's permissions", async () => {
    invoices.findPastDueIssued.mockResolvedValue([
      { id: 'a', organizationId: 'org-1' },
      { id: 'b', organizationId: 'org-2' },
    ]);
    const seen: unknown[] = [];
    service.markOverdue.mockImplementation(async () => {
      const context = getCurrentCorrelationContext();
      seen.push({
        organizationId: context?.organizationId,
        actor: context?.systemActor,
        permissions: context?.permissions,
        userId: context?.userId,
      });
      return true;
    });

    await scheduler.tick(NOW);

    expect(seen).toEqual([
      {
        organizationId: 'org-1',
        actor: 'overdue-job',
        permissions: ['invoice:read', 'invoice:write'],
        userId: undefined,
      },
      {
        organizationId: 'org-2',
        actor: 'overdue-job',
        permissions: ['invoice:read', 'invoice:write'],
        userId: undefined,
      },
    ]);
  });

  // A short lease renewed per invoice: failover is fast, and a stalled leader doesn't overlap its successor.
  it('renews the lease before every invoice, and stops the pass if it has been lost', async () => {
    invoices.findPastDueIssued.mockResolvedValue([
      { id: 'a', organizationId: 'o' },
      { id: 'b', organizationId: 'o' },
      { id: 'c', organizationId: 'o' },
    ]);
    redis.eval
      .mockResolvedValueOnce(1) // the pass starts as leader
      .mockResolvedValueOnce(1) // before a
      .mockResolvedValueOnce(0); // before b: someone else leads now

    await expect(scheduler.tick(NOW)).resolves.toMatchObject({ marked: 1, fullBatch: false });
    expect(service.markOverdue).toHaveBeenCalledTimes(1);
    expect(invoices.findDueReminders).not.toHaveBeenCalled();
  });

  it('keeps going when one invoice fails, counting it for retry next pass', async () => {
    invoices.findPastDueIssued.mockResolvedValue([
      { id: 'a', organizationId: 'org-1' },
      { id: 'b', organizationId: 'org-1' },
    ]);
    service.markOverdue.mockRejectedValueOnce(new Error('user-access down')).mockResolvedValueOnce(true);

    await expect(scheduler.tick(NOW)).resolves.toMatchObject({ marked: 1, failed: 1 });
    expect(service.markOverdue).toHaveBeenCalledTimes(2);
  });

  it('counts skipped reminders and no-ops apart from sent ones', async () => {
    invoices.findDueReminders.mockResolvedValue([
      { id: 'a', organizationId: 'o' },
      { id: 'b', organizationId: 'o' },
    ]);
    service.sendDueReminder.mockResolvedValueOnce('skipped').mockResolvedValueOnce('none');

    await expect(scheduler.tick(NOW)).resolves.toMatchObject({ reminded: 0, skipped: 1, failed: 0 });
  });

  it('reports a full batch, so the next pass starts at once', async () => {
    invoices.findPastDueIssued.mockResolvedValue([
      { id: 'a', organizationId: 'o' },
      { id: 'b', organizationId: 'o' },
    ]);

    await expect(scheduler.tick(NOW)).resolves.toMatchObject({ fullBatch: true });
  });

  it.each([
    [{}, 15 * 60 * 1000],
    [{ OVERDUE_SCAN_INTERVAL_MS: '30000' }, 30_000],
    [{ OVERDUE_SCAN_INTERVAL_MS: 'nonsense' }, 15 * 60 * 1000],
  ])('reads the interval from the environment (%j)', (env, intervalMs) => {
    expect(overdueSchedulerOptionsFromEnv(env as NodeJS.ProcessEnv).intervalMs).toBe(intervalMs);
  });
});
