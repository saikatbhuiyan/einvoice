import type { SupportedCurrency } from '@libs/shared/types';

/**
 * ISO 4217 minor-unit exponents: an amount of 1 in the currency is 10^exponent minor units (BDT:
 * 100 poisha, USD: 100 cents). Every supported currency has 2 today; nothing else may assume that --
 * read it from here.
 */
export const CURRENCY_EXPONENT: Readonly<Record<SupportedCurrency, number>> = {
  BDT: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
};

/** How each currency is written for its usual readers: BDT with ৳ and lakh/crore grouping. */
const CURRENCY_LOCALE: Readonly<Record<SupportedCurrency, string>> = {
  BDT: 'en-IN',
  USD: 'en-US',
  EUR: 'en-IE',
  GBP: 'en-GB',
};

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function exponentOf(currency: SupportedCurrency): number {
  const exponent = CURRENCY_EXPONENT[currency];
  if (exponent === undefined) throw new MoneyError(`Unsupported currency "${currency}".`);
  return exponent;
}

/**
 * A decimal amount (as the API takes it, e.g. 1500.55) in minor units (150055). Refuses more
 * decimals than the currency has -- 1500.555 BDT is not an amount -- and anything that isn't a
 * finite number or doesn't fit exactly in an integer.
 */
export function toMinor(amount: number, currency: SupportedCurrency): number {
  if (!Number.isFinite(amount)) throw new MoneyError(`${amount} is not an amount.`);
  const exponent = exponentOf(currency);
  const scaled = amount * 10 ** exponent;
  const minor = Math.round(scaled);
  // Binary floating point makes 1500.55 * 100 = 150055.00000000003; a real extra digit is far bigger.
  if (Math.abs(scaled - minor) > 1e-6) {
    throw new MoneyError(`${amount} ${currency} has more than ${exponent} decimal places.`);
  }
  if (!Number.isSafeInteger(minor)) throw new MoneyError(`${amount} ${currency} is too large.`);
  return minor;
}

/** Minor units back to a decimal number, for the API's (unchanged) decimal shape. */
export function fromMinor(minor: number, currency: SupportedCurrency): number {
  return minor / 10 ** exponentOf(currency);
}

/** e.g. `৳1,23,45,678.50` (BDT), `$1,234.50` (USD). */
export function formatMoney(minor: number, currency: SupportedCurrency, locale = CURRENCY_LOCALE[currency]): string {
  const exponent = exponentOf(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(fromMinor(minor, currency));
}

/**
 * Minor units as a grouped number without a currency symbol, for columns whose heading names the
 * currency ("Total Value (TAKA)"): 138242654 BDT -> "13,82,426.54".
 */
export function formatAmount(minor: number, currency: SupportedCurrency, locale = CURRENCY_LOCALE[currency]): string {
  const exponent = exponentOf(currency);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(fromMinor(minor, currency));
}
