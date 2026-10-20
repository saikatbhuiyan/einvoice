/**
 * Payment reminders: an organization's schedule is a list of day offsets after an invoice's due
 * date (e.g. 1, 7 and 14 days overdue). An empty list turns reminders off for that organization.
 */
export const DEFAULT_REMINDER_OFFSETS_DAYS: readonly number[] = [1, 7, 14];

export const REMINDER_OFFSET_LIMITS = { maxCount: 10, minDays: 1, maxDays: 365 } as const;

/**
 * Why `offsets` is not a valid schedule, or null if it is: whole days within the limits, strictly
 * ascending (so each reminder comes later than the last), at most `maxCount` of them. Shared by the
 * gateway DTO and the service that stores it -- RPC payloads skip DTO validation.
 */
export function reminderScheduleProblem(offsets: unknown): string | null {
  const { maxCount, minDays, maxDays } = REMINDER_OFFSET_LIMITS;
  if (!Array.isArray(offsets)) return 'reminderOffsetsDays must be an array of days.';
  if (offsets.length > maxCount) return `reminderOffsetsDays allows at most ${maxCount} reminders.`;
  for (const [index, days] of offsets.entries()) {
    if (!Number.isInteger(days) || days < minDays || days > maxDays) {
      return `reminderOffsetsDays must be whole days from ${minDays} to ${maxDays}.`;
    }
    if (index > 0 && days <= offsets[index - 1]) {
      return 'reminderOffsetsDays must be strictly ascending.';
    }
  }
  return null;
}
