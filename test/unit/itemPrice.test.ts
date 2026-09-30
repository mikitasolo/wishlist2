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

  // regression: the guard was a truthiness check on the value, so a free item
  // (price 0) came back null and sorted with the priceless items, at the end,
  // instead of first under "price: low to high".
  it('regression: converts a zero price to 0, not null', () => {
    expect(itemPriceInUsdCents({ value: 0, currency: 'usd' }, rates)).toBe(0);
    expect(itemPriceInUsdCents({ value: 0, currency: 'eur' }, rates)).toBe(0);
  });

  it('is null for a missing currency', () => {
    expect(itemPriceInUsdCents({ value: 500, currency: '' }, rates)).toBeNull();
  });

  it('is null when there is no rate for the currency, so it sorts with the unpriced items', () => {
    expect(itemPriceInUsdCents({ value: 500, currency: 'jpy' }, rates)).toBeNull();
    expect(itemPriceInUsdCents({ value: 500, currency: 'eur' }, new Map())).toBeNull();
    expect(itemPriceInUsdCents({ value: 0, currency: 'jpy' }, rates)).toBeNull();
  });
});
