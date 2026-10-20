import { daysOverdue, isPastDue, nextReminderAt } from './reminder-schedule';

const at = (iso: string) => new Date(iso);
const DUE = at('2026-10-10T00:00:00.000Z'); // due on the 10th
const OFFSETS = [1, 7, 14];

describe('reminder schedule', () => {
  describe('isPastDue (UTC, the day after the due date)', () => {
    it.each([
      ['during the due day', '2026-10-10T23:59:59.999Z', false],
      ['from the next day', '2026-10-11T00:00:00.000Z', true],
      ['before the due day', '2026-10-09T12:00:00.000Z', false],
    ])('%s -> %s', (_label, now, expected) => {
      expect(isPastDue(DUE, at(now))).toBe(expected);
    });
  });

  describe('nextReminderAt', () => {
    it('schedules the first reminder for the first overdue moment (offset 1)', () => {
      expect(nextReminderAt(DUE, OFFSETS, null, at('2026-10-11T00:05:00Z'))).toEqual(at('2026-10-11T00:00:00Z'));
    });

    it('after a reminder, schedules the next one', () => {
      const first = at('2026-10-11T00:00:00Z');

      expect(nextReminderAt(DUE, OFFSETS, first, at('2026-10-11T00:05:00Z'))).toEqual(at('2026-10-17T00:00:00Z'));
    });

    it('is null once the schedule is exhausted, or when it is empty (reminders off)', () => {
      expect(nextReminderAt(DUE, OFFSETS, at('2026-10-24T00:00:00Z'), at('2026-10-24T00:05:00Z'))).toBeNull();
      expect(nextReminderAt(DUE, [], null, at('2026-10-11T00:05:00Z'))).toBeNull();
    });

    // Rollout safety: an invoice that was already late when first seen gets no burst of old reminders.
    it('skips reminders missed by more than a day instead of sending them late', () => {
      // First seen 3 days overdue: the day-1 reminder is 2 days old -> skip to day 7.
      expect(nextReminderAt(DUE, OFFSETS, null, at('2026-10-13T09:00:00Z'))).toEqual(at('2026-10-17T00:00:00Z'));
      // A month overdue: everything is long past -> nothing.
      expect(nextReminderAt(DUE, OFFSETS, null, at('2026-11-10T09:00:00Z'))).toBeNull();
    });

    it('still sends a reminder missed by less than a day (a short scheduler outage)', () => {
      expect(nextReminderAt(DUE, OFFSETS, null, at('2026-10-11T20:00:00Z'))).toEqual(at('2026-10-11T00:00:00Z'));
    });
  });

  it('counts whole days overdue', () => {
    expect(daysOverdue(DUE, at('2026-10-11T00:05:00Z'))).toBe(1);
    expect(daysOverdue(DUE, at('2026-10-17T23:00:00Z'))).toBe(7);
  });
});
