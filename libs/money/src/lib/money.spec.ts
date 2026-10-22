import { MoneyError, formatMoney, fromMinor, toMinor } from './currency';
import { computeLine, divideHalfUp, sumAmounts, type Amounts } from './tax';

describe('money', () => {
  describe('toMinor / fromMinor', () => {
    it.each([
      [1500, 150000],
      [1500.5, 150050],
      [1500.55, 150055], // 1500.55 * 100 is 150055.00000000003 in binary floating point
      [0.1 + 0.2, 30], // 0.30000000000000004 -> 30 poisha, not an error
      [0, 0],
    ])('%s BDT -> %s poisha', (amount, minor) => {
      expect(toMinor(amount, 'BDT')).toBe(minor);
    });

    it('round-trips', () => {
      expect(fromMinor(toMinor(1234.56, 'USD'), 'USD')).toBe(1234.56);
    });

    it.each([[1500.555], [Number.NaN], [Number.POSITIVE_INFINITY], [1e20]])('refuses %s', (amount) => {
      expect(() => toMinor(amount, 'BDT')).toThrow(MoneyError);
    });
  });

  describe('formatMoney', () => {
    it.each([
      [1234567850, 'BDT', '৳1,23,45,678.50'], // lakh/crore grouping
      [150000, 'BDT', '৳1,500.00'],
      [123456750, 'USD', '$1,234,567.50'],
      [123456750, 'EUR', '€1,234,567.50'],
      [5, 'GBP', '£0.05'],
    ] as const)('%s minor %s -> %s', (minor, currency, expected) => {
      expect(formatMoney(minor, currency)).toBe(expected);
    });

    // For Mushak-6.3 later: the same amount in Bengali numerals.
    it('can write BDT in Bengali numerals', () => {
      expect(formatMoney(1234567850, 'BDT', 'bn-BD')).toBe('১,২৩,৪৫,৬৭৮.৫০৳');
    });
  });

  describe('divideHalfUp', () => {
    it.each([
      [5, 2, 3],
      [4, 2, 2],
      [7, 2, 4],
      [1, 3, 0],
      [2, 3, 1],
      [-5, 2, -3], // away from zero, symmetric (credit notes later)
    ])('%s / %s -> %s', (n, d, expected) => {
      expect(divideHalfUp(BigInt(n), BigInt(d))).toBe(BigInt(expected));
    });
  });

  describe('computeLine', () => {
    it('15% VAT on BDT 10,000', () => {
      expect(computeLine({ quantity: 1, unitPriceMinor: 1_000_000, vatRate: 15 })).toEqual({
        netMinor: 1_000_000,
        sdMinor: 0,
        vatMinor: 150_000,
        totalMinor: 1_150_000,
      });
    });

    // Bangladesh: VAT is charged on the SD-inclusive value.
    it('charges VAT on net + supplementary duty', () => {
      expect(computeLine({ quantity: 1, unitPriceMinor: 1_000_000, sdRate: 20, vatRate: 15 })).toEqual({
        netMinor: 1_000_000, // 10,000.00
        sdMinor: 200_000, //    2,000.00 (20%)
        vatMinor: 180_000, //   1,800.00 = 15% of 12,000.00
        totalMinor: 1_380_000,
      });
    });

    it('handles fractional rates (7.5%) and quantities, rounding half-up to the minor unit', () => {
      // 1.5 x 33.33 = 49.995 -> 50.00; 7.5% of 50.00 = 3.75
      expect(computeLine({ quantity: 1.5, unitPriceMinor: 3333, vatRate: 7.5 })).toEqual({
        netMinor: 5000,
        sdMinor: 0,
        vatMinor: 375,
        totalMinor: 5375,
      });
      // 15% of 0.30 = 0.045 -> 0.05
      expect(computeLine({ quantity: 3, unitPriceMinor: 10, vatRate: 15 }).vatMinor).toBe(5);
    });

    it('refuses more precision than it can represent', () => {
      expect(() => computeLine({ quantity: 1.005, unitPriceMinor: 100, vatRate: 0 })).toThrow(/2 decimal places/);
      expect(() => computeLine({ quantity: 1, unitPriceMinor: 100, vatRate: 7.525 })).toThrow(/2 decimal places/);
      expect(() => computeLine({ quantity: 1, unitPriceMinor: 10.5, vatRate: 0 })).toThrow(/whole number/);
    });

    // The schema's limits: 1,000,000 x 1,000,000,000.00 overflows 2^53 minor units; refused, not rounded.
    it('refuses a line too large to represent exactly instead of losing precision', () => {
      expect(() => computeLine({ quantity: 1_000_000, unitPriceMinor: 100_000_000_000, vatRate: 15 })).toThrow(
        /too large/,
      );
    });
  });

  describe('sumAmounts', () => {
    it('totals are exactly the sums of the line amounts, over many lines', () => {
      let seed = 42;
      const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
      const lines: Amounts[] = Array.from({ length: 10_000 }, () =>
        computeLine({
          quantity: Math.round(random() * 10_000) / 100,
          unitPriceMinor: Math.round(random() * 10_000_000),
          vatRate: [0, 5, 7.5, 10, 15][Math.floor(random() * 5)],
          sdRate: random() < 0.2 ? 20 : 0,
        }),
      );

      const totals = sumAmounts(lines);

      expect(totals.totalMinor).toBe(totals.netMinor + totals.sdMinor + totals.vatMinor);
      expect(totals.netMinor).toBe(lines.reduce((sum, line) => sum + line.netMinor, 0));
      for (const value of Object.values(totals)) expect(Number.isSafeInteger(value)).toBe(true);
    });
  });
});
