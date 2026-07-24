import { describe, it, expect } from 'vitest';
import { formatPrice, formatPriceFromObject, convertPrice } from '@/lib/utils/currency';

describe('formatPrice', () => {
  it('formats cents as an uppercase code + amount', () => {
    expect(formatPrice(9999, 'usd')).toBe('USD 99.99');
    expect(formatPrice(500, 'eur')).toBe('EUR 5.00');
  });

  it('defaults to USD and returns "-" for missing values', () => {
    expect(formatPrice(100)).toBe('USD 1.00');
    expect(formatPrice(null)).toBe('-');
    expect(formatPrice(undefined)).toBe('-');
  });

  it('handles zero', () => {
    expect(formatPrice(0, 'usd')).toBe('USD 0.00');
  });
});

describe('formatPriceFromObject', () => {
  it('formats a price object', () => {
    expect(formatPriceFromObject({ value: 1250, currency: 'gbp' })).toBe('GBP 12.50');
  });
  it('returns "-" for null/undefined', () => {
    expect(formatPriceFromObject(null)).toBe('-');
    expect(formatPriceFromObject(undefined)).toBe('-');
  });
});

describe('convertPrice (client-side, rates = units per USD)', () => {
  // 1 USD = 4 PLN, 1 USD = 0.5 EUR
  const rates = { pln: 4, eur: 0.5 };

  it('returns the same value when source === target', () => {
    expect(convertPrice({ value: 400, currency: 'pln' }, 'pln', rates)).toEqual({
      value: 400,
      currency: 'pln',
    });
  });

  it('converts a non-USD price to USD', () => {
    // 400 grosz (4 PLN) → 100 US cents ($1.00)
    expect(convertPrice({ value: 400, currency: 'pln' }, 'usd', rates)).toEqual({
      value: 100,
      currency: 'usd',
    });
  });

  it('converts USD to a non-USD currency', () => {
    // $1.00 → 4 PLN (400 grosz)
    expect(convertPrice({ value: 100, currency: 'usd' }, 'pln', rates)).toEqual({
      value: 400,
      currency: 'pln',
    });
  });

  it('converts between two non-USD currencies via USD', () => {
    // 4 PLN → $1 → 0.5 EUR (50 euro cents)
    expect(convertPrice({ value: 400, currency: 'pln' }, 'eur', rates)).toEqual({
      value: 50,
      currency: 'eur',
    });
  });

  it('is case-insensitive on currency codes', () => {
    expect(convertPrice({ value: 400, currency: 'PLN' }, 'USD', rates)).toEqual({
      value: 100,
      currency: 'usd',
    });
  });

  it('returns null when a needed rate is missing', () => {
    expect(convertPrice({ value: 100, currency: 'jpy' }, 'usd', rates)).toBeNull();
    expect(convertPrice({ value: 100, currency: 'usd' }, 'jpy', rates)).toBeNull();
  });

  // Regression: items page sorted 3000 PLN above 2000 USD because prices were
  // compared in raw minor units rather than a common currency. Converting to a
  // common base must reflect true value.
  it('regression: a large PLN price is worth less in USD than a smaller USD price', () => {
    const plnInUsd = convertPrice({ value: 300000, currency: 'pln' }, 'usd', rates)!; // 3000 PLN
    const usd = { value: 200000 }; // $2000
    expect(plnInUsd.value).toBeLessThan(usd.value); // 3000 PLN ($750) < $2000
  });
});
