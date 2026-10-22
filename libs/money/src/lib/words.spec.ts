import { MoneyError } from './currency';
import { amountInWords, numberInWords } from './words';

describe('numberInWords (South Asian scale)', () => {
  it.each([
    [0, 'Zero'],
    [7, 'Seven'],
    [13, 'Thirteen'],
    [20, 'Twenty'],
    [21, 'Twenty-One'],
    [99, 'Ninety-Nine'],
    [100, 'One Hundred'],
    [101, 'One Hundred One'],
    [426, 'Four Hundred Twenty-Six'],
    [1_000, 'One Thousand'],
    [99_999, 'Ninety-Nine Thousand Nine Hundred Ninety-Nine'],
    [1_00_000, 'One Lakh'],
    [1_00_001, 'One Lakh One'],
    [13_82_426, 'Thirteen Lakh Eighty-Two Thousand Four Hundred Twenty-Six'],
    [99_99_999, 'Ninety-Nine Lakh Ninety-Nine Thousand Nine Hundred Ninety-Nine'],
    [1_00_00_000, 'One Crore'],
    [1_23_45_678, 'One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight'],
    // Beyond 99 crore the crore count is itself spelled out (Indian/Bangladeshi usage).
    [1_000_00_00_000, 'One Thousand Crore'],
    [
      12_34_56_78_901,
      'One Thousand Two Hundred Thirty-Four Crore Fifty-Six Lakh Seventy-Eight Thousand Nine Hundred One',
    ],
  ])('%d -> %s', (value, words) => {
    expect(numberInWords(value)).toBe(words);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('refuses %d', (value) => {
    expect(() => numberInWords(value)).toThrow(MoneyError);
  });
});

describe('amountInWords', () => {
  it.each([
    [138_242_654, 'Taka Thirteen Lakh Eighty-Two Thousand Four Hundred Twenty-Six and Poisha Fifty-Four Only'],
    [150_000_000, 'Taka Fifteen Lakh Only'],
    [100, 'Taka One Only'],
    [5, 'Taka Zero and Poisha Five Only'],
    [0, 'Taka Zero Only'],
  ])('BDT %d -> %s', (minor, words) => {
    expect(amountInWords(minor, 'BDT')).toBe(words);
  });

  it.each([
    [123_450, 'USD', 'One Thousand Two Hundred Thirty-Four US Dollars and Fifty Cents Only'],
    [100, 'USD', 'One US Dollar Only'],
    [101, 'USD', 'One US Dollar and One Cent Only'],
    [
      123_456_789_00,
      'USD',
      'One Hundred Twenty-Three Million Four Hundred Fifty-Six Thousand Seven Hundred Eighty-Nine US Dollars Only',
    ],
    [12_990, 'EUR', 'One Hundred Twenty-Nine Euros and Ninety Cents Only'],
    [1, 'GBP', 'Zero Pounds Sterling and One Penny Only'],
  ] as const)('%d %s -> %s', (minor, currency, words) => {
    expect(amountInWords(minor, currency)).toBe(words);
  });

  it('refuses a negative or fractional amount', () => {
    expect(() => amountInWords(-1, 'BDT')).toThrow(MoneyError);
    expect(() => amountInWords(10.5, 'BDT')).toThrow(MoneyError);
  });
});
