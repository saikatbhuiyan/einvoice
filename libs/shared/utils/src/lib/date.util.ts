export function toISOString(date: Date | string | number = new Date()): string {
  return new Date(date).toISOString();
}

export function formatDisplay(date: Date | string | number, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

export function addDays(date: Date | string, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function isPast(date: Date | string | number): boolean {
  return new Date(date).getTime() < Date.now();
}

export function isFuture(date: Date | string | number): boolean {
  return new Date(date).getTime() > Date.now();
}

export function diffInDays(start: Date | string, end: Date | string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.trunc(ms / (1000 * 60 * 60 * 24));
}
