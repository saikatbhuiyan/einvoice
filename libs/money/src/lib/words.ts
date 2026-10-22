import type { SupportedCurrency } from '@libs/shared/types';
import { MoneyError, exponentOf } from './currency';

const ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** Largest scale first. A count above a scale's range is itself spelled out ("One Thousand Crore"). */
type Scale = readonly (readonly [number, string])[];
const SOUTH_ASIAN: Scale = [
  [10_000_000, 'Crore'],
  [100_000, 'Lakh'],
  [1_000, 'Thousand'],
  [100, 'Hundred'],
];
const WESTERN: Scale = [
  [1_000_000_000_000, 'Trillion'],
  [1_000_000_000, 'Billion'],
  [1_000_000, 'Million'],
  [1_000, 'Thousand'],
  [100, 'Hundred'],
];

/** How each currency's units read on a document. BDT follows Bangladeshi usage: "Taka … and Poisha … Only". */
const NAMES: Record<
  SupportedCurrency,
  { major: [string, string]; minor: [string, string]; scale: Scale; prefix: boolean }
> = {
  BDT: { major: ['Taka', 'Taka'], minor: ['Poisha', 'Poisha'], scale: SOUTH_ASIAN, prefix: true },
  USD: { major: ['US Dollar', 'US Dollars'], minor: ['Cent', 'Cents'], scale: WESTERN, prefix: false },
  EUR: { major: ['Euro', 'Euros'], minor: ['Cent', 'Cents'], scale: WESTERN, prefix: false },
  GBP: { major: ['Pound Sterling', 'Pounds Sterling'], minor: ['Penny', 'Pence'], scale: WESTERN, prefix: false },
};

/** A whole number in words on the given scale: 1,23,45,678 -> "One Crore Twenty-Three Lakh …". */
export function numberInWords(value: number, scale: Scale = SOUTH_ASIAN): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError(`${value} can't be written in words (a non-negative whole number is needed).`);
  }
  if (value < 20) return ONES[value];
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)];
    return value % 10 === 0 ? tens : `${tens}-${ONES[value % 10]}`;
  }
  for (const [size, name] of scale) {
    if (value >= size) {
      const count = Math.floor(value / size);
      const rest = value % size;
      const head = `${numberInWords(count, scale)} ${name}`;
      return rest === 0 ? head : `${head} ${numberInWords(rest, scale)}`;
    }
  }
  /* istanbul ignore next -- every scale ends with Hundred, so values >= 100 always match one */
  throw new MoneyError(`No scale for ${value}.`);
}

/**
 * An amount in minor units, in words, as a tax invoice's "In words" line reads:
 * BDT 138242654 -> "Taka Thirteen Lakh Eighty-Two Thousand Four Hundred Twenty-Six and Poisha Fifty-Four Only";
 * USD 123450 -> "One Thousand Two Hundred Thirty-Four US Dollars and Fifty Cents Only".
 */
export function amountInWords(minor: number, currency: SupportedCurrency): string {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new MoneyError(
      `${minor} ${currency} can't be written in words (a non-negative amount in minor units is needed).`,
    );
  }
  const names = NAMES[currency];
  const scale = 10 ** exponentOf(currency);
  const major = Math.floor(minor / scale);
  const fraction = minor % scale;
  const plural = (count: number, [one, many]: [string, string]) => (count === 1 ? one : many);
  const majorWords = numberInWords(major, names.scale);
  const minorWords = numberInWords(fraction, names.scale);

  if (names.prefix) {
    const head = `${plural(major, names.major)} ${majorWords}`;
    return fraction === 0 ? `${head} Only` : `${head} and ${plural(fraction, names.minor)} ${minorWords} Only`;
  }
  const head = `${majorWords} ${plural(major, names.major)}`;
  return fraction === 0 ? `${head} Only` : `${head} and ${minorWords} ${plural(fraction, names.minor)} Only`;
}
