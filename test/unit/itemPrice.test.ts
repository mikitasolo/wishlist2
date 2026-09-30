import { describe, it, expect } from 'vitest';
import { itemPriceInUsdCents } from '@/lib/utils/itemPrice';

// rates = units per USD (as returned by the currency API). Map form.
const rates = new Map<string, number>([
  ['usd', 1],
  ['eur', 0.5],
]);

describe('itemPriceInUsdCents', () => {
  it('converts a priced item to USD cents', () => {
    expect(itemPriceInUsdCents({ value: 1234, currency: 'usd' }, rates)).toBe(1234);
    // 10.00 EUR at 0.5 EUR per USD = $20.00
    expect(itemPriceInUsdCents({ value: 1000, currency: 'eur' }, rates)).toBe(2000);
  });

  it('is null for an item without a price', () => {
    expect(itemPriceInUsdCents(null, rates)).toBeNull();
    expect(itemPriceInUsdCents(undefined, rates)).toBeNull();
  });

  it('is null for a zero value or a missing currency, as the list read has always had it', () => {
    expect(itemPriceInUsdCents({ value: 0, currency: 'usd' }, rates)).toBeNull();
    expect(itemPriceInUsdCents({ value: 500, currency: '' }, rates)).toBeNull();
  });

  it('is null when there is no rate for the currency, so it sorts with the unpriced items', () => {
    expect(itemPriceInUsdCents({ value: 500, currency: 'jpy' }, rates)).toBeNull();
    expect(itemPriceInUsdCents({ value: 500, currency: 'eur' }, new Map())).toBeNull();
  });
});
