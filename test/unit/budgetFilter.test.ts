import { describe, it, expect } from 'vitest';
import {
  filterByBudget,
  hasPricedItem,
  isWithinBudget,
  parseBudget,
} from '@/lib/utils/budgetFilter';

// Units per USD.
const RATES = { usd: 1, eur: 0.5, pln: 4 };
const p = (value: number, currency: string) => ({ value, currency });

describe('parseBudget', () => {
  it('reads an amount in cents, an empty field as no limit, junk as invalid', () => {
    expect(parseBudget('50')).toBe(5000);
    expect(parseBudget('49,99')).toBe(4999);
    expect(parseBudget('  ')).toBeNull();
    expect(parseBudget('abc')).toBe('invalid');
    expect(parseBudget('-5')).toBe('invalid');
  });
});

describe('isWithinBudget', () => {
  it('compares in the viewer’s currency, inclusively', () => {
    expect(isWithinBudget(p(5000, 'PLN'), 5000, 'PLN', null)).toBe(true);
    expect(isWithinBudget(p(5001, 'pln'), 5000, 'PLN', null)).toBe(false);
  });

  it('converts a price in another currency as the Prices control does', () => {
    // 10000 EUR cents = 800.00 PLN
    expect(isWithinBudget(p(10000, 'eur'), 80000, 'PLN', RATES)).toBe(true);
    expect(isWithinBudget(p(10000, 'eur'), 79999, 'PLN', RATES)).toBe(false);
  });

  it('keeps what it can’t judge: no price, no rates, an unknown currency', () => {
    expect(isWithinBudget(null, 1, 'PLN', RATES)).toBe(true);
    expect(isWithinBudget(undefined, 1, 'PLN', RATES)).toBe(true);
    expect(isWithinBudget(p(10000, 'eur'), 1, 'PLN', null)).toBe(true);
    expect(isWithinBudget(p(10000, 'xyz'), 1, 'PLN', RATES)).toBe(true);
  });
});

describe('filterByBudget', () => {
  const items = [
    { id: 'a', price: p(10000, 'eur') },
    { id: 'b', price: p(4000, 'pln') },
    { id: 'c' },
  ];
  it('returns everything for no limit', () => {
    expect(filterByBudget(items, null, 'PLN', RATES)).toHaveLength(3);
  });
  it('keeps order and drops only what is over', () => {
    expect(filterByBudget(items, 50000, 'PLN', RATES).map((i) => i.id)).toEqual(['b', 'c']);
  });
  it('treats a zero limit as a limit', () => {
    expect(filterByBudget(items, 0, 'PLN', RATES).map((i) => i.id)).toEqual(['c']);
  });
});

describe('hasPricedItem', () => {
  it('is true only when some item has a price', () => {
    expect(hasPricedItem([{ price: null }, {}])).toBe(false);
    expect(hasPricedItem([{}, { price: p(1, 'USD') }])).toBe(true);
  });
});
