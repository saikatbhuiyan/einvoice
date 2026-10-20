import { DEFAULT_REMINDER_OFFSETS_DAYS, reminderScheduleProblem } from './reminder.types';

describe('reminderScheduleProblem', () => {
  it.each([
    ['the default', [...DEFAULT_REMINDER_OFFSETS_DAYS]],
    ['an empty schedule (reminders off)', []],
    ['the limits', [1, 365]],
    ['ten reminders', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
  ])('accepts %s', (_label, offsets) => {
    expect(reminderScheduleProblem(offsets)).toBeNull();
  });

  it.each([
    ['not an array', 7, /array/],
    ['day 0 (that is the due date itself)', [0, 7], /from 1 to 365/],
    ['more than a year', [400], /from 1 to 365/],
    ['fractions', [1.5], /whole days/],
    ['a string', ['7'], /whole days/],
    ['a repeat', [7, 7], /ascending/],
    ['descending', [14, 7], /ascending/],
    ['eleven reminders', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], /at most 10/],
  ])('refuses %s', (_label, offsets, message) => {
    expect(reminderScheduleProblem(offsets)).toMatch(message);
  });
});
