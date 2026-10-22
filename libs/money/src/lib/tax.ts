import { MoneyError } from './currency';

/**
 * Line and invoice amounts, all in integer minor units, computed with exact integer arithmetic
 * (BigInt for the intermediate products: unit price x quantity can exceed 2^53 long before any real
 * invoice does, and a silently imprecise intermediate is exactly what this replaces).
 *
 *   net   = quantity x unit price
 *   sd    = net x SD rate                 (Bangladesh supplementary duty; 0 elsewhere)
 *   vat   = (net + sd) x VAT rate          (VAT is charged on the SD-inclusive value)
 *   total = net + sd + vat
 *
 * Each amount is rounded half-up (away from zero) to the minor unit, per line; invoice totals are the
 * sums of the rounded line amounts, so the lines on a document always add up to its totals.
 * Quantity and rates have at most 2 decimals (rates are percentages: 7.5 means 7.5%).
 */
export interface LineInput {
  quantity: number;
  unitPriceMinor: number;
  vatRate: number;
  sdRate?: number;
}

export interface Amounts {
  netMinor: number;
  sdMinor: number;
  vatMinor: number;
  totalMinor: number;
}

const QUANTITY_DECIMALS = 2;
const RATE_DECIMALS = 2;

// BigInt values built with BigInt(), not `123n` literals or `**`: every project compiles this source
// with its own target, and below ES2020 literals don't compile and `**` is downleveled to Math.pow,
// which throws on BigInt.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const QUANTITY_SCALE = BigInt(100); // quantity in hundredths
const PERCENT_SCALE = BigInt(10_000); // rate in hundredths of a percent -> fraction

export function computeLine(line: LineInput): Amounts {
  const quantity = scaled(line.quantity, QUANTITY_DECIMALS, 'quantity'); // hundredths
  const unitPrice = integer(line.unitPriceMinor, 'unitPriceMinor');
  const sdRate = scaled(line.sdRate ?? 0, RATE_DECIMALS, 'sdRate'); // hundredths of a percent
  const vatRate = scaled(line.vatRate, RATE_DECIMALS, 'vatRate');

  const net = divideHalfUp(unitPrice * quantity, QUANTITY_SCALE);
  const sd = divideHalfUp(net * sdRate, PERCENT_SCALE);
  const vat = divideHalfUp((net + sd) * vatRate, PERCENT_SCALE);

  return {
    netMinor: safe(net, 'line net'),
    sdMinor: safe(sd, 'line SD'),
    vatMinor: safe(vat, 'line VAT'),
    totalMinor: safe(net + sd + vat, 'line total'),
  };
}

/** Invoice totals: the sums of already-rounded line amounts. */
export function sumAmounts(lines: readonly Amounts[]): Amounts {
  const sum = (pick: (amounts: Amounts) => number) => lines.reduce((total, line) => total + BigInt(pick(line)), ZERO);
  return {
    netMinor: safe(
      sum((l) => l.netMinor),
      'net total',
    ),
    sdMinor: safe(
      sum((l) => l.sdMinor),
      'SD total',
    ),
    vatMinor: safe(
      sum((l) => l.vatMinor),
      'VAT total',
    ),
    totalMinor: safe(
      sum((l) => l.totalMinor),
      'invoice total',
    ),
  };
}

/** n / d rounded half away from zero, in exact integers. */
export function divideHalfUp(n: bigint, d: bigint): bigint {
  const sign = n < ZERO ? -ONE : ONE;
  const magnitude = n * sign;
  return sign * ((TWO * magnitude + d) / (TWO * d));
}

function scaled(value: number, decimals: number, what: string): bigint {
  if (!Number.isFinite(value)) throw new MoneyError(`${what} must be a number.`);
  const exact = value * 10 ** decimals;
  const rounded = Math.round(exact);
  if (Math.abs(exact - rounded) > 1e-6) {
    throw new MoneyError(`${what} allows at most ${decimals} decimal places (got ${value}).`);
  }
  return BigInt(rounded);
}

function integer(value: number, what: string): bigint {
  if (!Number.isSafeInteger(value))
    throw new MoneyError(`${what} must be a whole number of minor units (got ${value}).`);
  return BigInt(value);
}

function safe(value: bigint, what: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new MoneyError(`The ${what} is too large to represent exactly.`);
  return result;
}
