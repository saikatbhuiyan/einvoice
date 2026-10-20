const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A reminder that should have gone out longer ago than this is skipped rather than sent late. On
 * the first deploy every old unpaid invoice turns overdue at once; without this, each client would
 * get a reminder for it the same hour -- including for invoices settled offline and never marked paid.
 * One day also covers a scheduler outage: anything due during it still goes out once it's back.
 */
export const REMINDER_CATCH_UP_MS = DAY_MS;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Overdue means the due date has fully passed, in UTC: an invoice due on the 10th is overdue from
 * the 11th, 00:00 UTC. (Due dates are stored as midnight UTC of the due day.)
 */
export function isPastDue(dueDate: Date, now: Date): boolean {
  return dueDate.getTime() < startOfUtcDay(now).getTime();
}

/**
 * When the next reminder is due: the first `dueDate + offset` that comes after `after` (the
 * reminder just handled, or null for the first) and is not more than REMINDER_CATCH_UP_MS in the
 * past. Null when none is left -- the schedule is exhausted, or empty (reminders off).
 *
 * Offsets are whole days after the due date (validated ascending by user-access); offset 1 lands on
 * the first moment the invoice is overdue.
 */
export function nextReminderAt(
  dueDate: Date,
  offsetsDays: readonly number[],
  after: Date | null,
  now: Date,
): Date | null {
  for (const days of offsetsDays) {
    const at = new Date(dueDate.getTime() + days * DAY_MS);
    if (after && at.getTime() <= after.getTime()) continue;
    if (at.getTime() < now.getTime() - REMINDER_CATCH_UP_MS) continue;
    return at;
  }
  return null;
}

/** Whole days between the due date and `now` (1 on the first overdue day). */
export function daysOverdue(dueDate: Date, now: Date): number {
  return Math.max(0, Math.floor((startOfUtcDay(now).getTime() - dueDate.getTime()) / DAY_MS));
}
