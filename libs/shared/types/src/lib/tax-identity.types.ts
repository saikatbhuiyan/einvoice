/**
 * Who issues and who receives a tax invoice, and when "now" is for them. Shared by the gateway DTOs
 * and the services that store these values -- RPC payloads skip DTO validation, so each rule is
 * written once here and checked on both sides.
 */

/** Bangladesh: one zone, no daylight saving. An organization with a BIN is in it unless it says otherwise. */
export const BANGLADESH_TIME_ZONE = 'Asia/Dhaka';

/** Organizations that predate time zones keep the behaviour they had: UTC. */
export const DEFAULT_TIME_ZONE = 'UTC';

/** Bangladesh Business Identification Number: 13 digits. */
export const BIN_PATTERN = /^\d{13}$/;

export const TAX_IDENTITY_CONSTRAINTS = {
  address: { minLength: 5, maxLength: 300 },
  signatory: {
    name: { minLength: 2, maxLength: 120 },
    designation: { minLength: 2, maxLength: 80 },
  },
  /** Unit of supply on a product or line ("pcs", "kg", "service"). */
  unit: { maxLength: 16 },
} as const;

export interface AuthorizedSignatory {
  name: string;
  designation: string;
}

/** Why `bin` is not a BIN, or null if it is. */
export function binProblem(bin: unknown): string | null {
  return typeof bin === 'string' && BIN_PATTERN.test(bin) ? null : 'bin must be exactly 13 digits.';
}

/** Why `timeZone` is not an IANA time zone this runtime knows, or null if it is. */
export function timeZoneProblem(timeZone: unknown): string | null {
  // A name, never a raw offset ("+06:00"): Intl accepts offsets, but an offset doesn't follow a
  // zone's daylight-saving or legal changes.
  if (typeof timeZone !== 'string' || timeZone.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(timeZone)) {
    return 'timeZone must be an IANA time zone, e.g. "Asia/Dhaka".';
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return null;
  } catch {
    return `timeZone "${timeZone}" is not a known IANA time zone.`;
  }
}

/** Why `signatory` is not a valid authorised signatory, or null if it is. */
export function signatoryProblem(signatory: unknown): string | null {
  const { name, designation } = TAX_IDENTITY_CONSTRAINTS.signatory;
  const value = signatory as Partial<AuthorizedSignatory> | null;
  const ok = (text: unknown, limits: { minLength: number; maxLength: number }) =>
    typeof text === 'string' && text.trim().length >= limits.minLength && text.length <= limits.maxLength;
  if (typeof value !== 'object' || value === null || !ok(value.name, name) || !ok(value.designation, designation)) {
    return `authorizedSignatory needs a name (${name.minLength}-${name.maxLength} characters) and a designation (${designation.minLength}-${designation.maxLength} characters).`;
  }
  return null;
}

export interface LocalDateTime {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm, 24-hour */
  time: string;
}

/** The wall-clock date and time of `instant` in `timeZone` (an invoice's date and time of issue). */
export function localDateTime(instant: Date, timeZone: string): LocalDateTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const [year, month, day, hour, minute] = ['year', 'month', 'day', 'hour', 'minute'].map((type) =>
    Number(parts[type]),
  );
  return {
    year,
    month,
    day,
    hour,
    minute,
    date: `${parts['year']}-${parts['month']}-${parts['day']}`,
    time: `${parts['hour']}:${parts['minute']}`,
  };
}
