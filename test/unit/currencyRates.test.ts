import { describe, it, expect } from 'vitest';
import { convertToUsdCents, convertCurrency } from '@/lib/utils/currencyRates';

// rates = units per USD (as returned by the currency API). Map form.
const rates = new Map<string, number>([
  ['pln', 4],
  ['eur', 0.5],
]);

describe('convertToUsdCents', () => {
  it('returns the value unchanged for USD', () => {
    expect(convertToUsdCents(12345, 'usd', rates)).toBe(12345);
  });

  it('converts a foreign currency to USD cents', () => {
    expect(convertToUsdCents(400, 'pln', rates)).toBe(100); // 4 PLN = $1
    expect(convertToUsdCents(50, 'eur', rates)).toBe(100); // 0.5 EUR unit → $1
  });

  it('rounds to the nearest cent', () => {
    // 3 PLN → 75 US cents
    expect(convertToUsdCents(300, 'pln', rates)).toBe(75);
  });

  it('returns null on missing rate or bad input', () => {
    expect(convertToUsdCents(100, 'jpy', rates)).toBeNull();
    // @ts-expect-error deliberately bad input
    expect(convertToUsdCents(null, 'usd', rates)).toBeNull();
  });
});

describe('convertCurrency (routes through USD)', () => {
  it('converts between two non-USD currencies', () => {
    // 4 PLN → $1 → 0.5 EUR unit = 50 euro cents
    expect(convertCurrency(400, 'pln', 'eur', rates)).toBe(50);
  });

  it('handles USD as source or target', () => {
    expect(convertCurrency(100, 'usd', 'pln', rates)).toBe(400);
    expect(convertCurrency(400, 'pln', 'usd', rates)).toBe(100);
  });

  it('returns null when either side lacks a rate', () => {
    expect(convertCurrency(100, 'jpy', 'usd', rates)).toBeNull();
    expect(convertCurrency(100, 'usd', 'jpy', rates)).toBeNull();
  });
});

// WIS-49: new prices are stored uppercase, older ones lowercase until the
// `uppercase-currency-codes` migration has run; the rates map stays lowercase.
describe('either casing of a currency code', () => {
  it('converts an uppercase code as it does a lowercase one', () => {
    expect(convertToUsdCents(400, 'PLN', rates)).toBe(100);
    expect(convertToUsdCents(12345, 'USD', rates)).toBe(12345);
    expect(convertCurrency(400, 'PLN', 'EUR', rates)).toBe(50);
    expect(convertCurrency(400, 'pln', 'EUR', rates)).toBe(50);
    expect(convertCurrency(100, 'USD', 'pln', rates)).toBe(400);
    expect(convertCurrency(400, 'PLN', 'USD', rates)).toBe(100);
  });
});
