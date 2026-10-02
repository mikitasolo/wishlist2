import { describe, it, expect } from 'vitest';
import {
  CURRENCY_OPTIONS,
  POPULAR_CURRENCIES,
  currencySelectOptions,
  defaultItemCurrency,
  isOfferedCurrency,
} from '@/lib/utils/currencies';

describe('currency option lists', () => {
  it('exposes USD/EUR and no duplicate codes', () => {
    const codes = CURRENCY_OPTIONS.map((c) => c.code);
    expect(codes).toContain('USD');
    expect(codes).toContain('EUR');
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('popular currencies are all valid options', () => {
    const codes = new Set(CURRENCY_OPTIONS.map((c) => c.code));
    for (const p of POPULAR_CURRENCIES) expect(codes.has(p)).toBe(true);
  });

  it('says which codes the pickers offer, by their uppercase code', () => {
    for (const { code } of CURRENCY_OPTIONS) expect(isOfferedCurrency(code)).toBe(true);
    expect(isOfferedCurrency('UAH')).toBe(false);
    expect(isOfferedCurrency('pln')).toBe(false);
    expect(isOfferedCurrency('')).toBe(false);
  });

  it('select options are shaped { value, label } aligned with the option list', () => {
    expect(currencySelectOptions).toHaveLength(CURRENCY_OPTIONS.length);
    const usd = currencySelectOptions.find((o) => o.value === 'USD');
    expect(usd?.label).toContain('USD');
    expect(usd?.label).toContain('US Dollar');
  });
});

describe('defaultItemCurrency', () => {
  it("prefers the wishlist's currency over the viewer's default", () => {
    expect(defaultItemCurrency('PLN', 'EUR')).toBe('PLN');
  });

  it("falls back to the viewer's default when the wishlist has none", () => {
    expect(defaultItemCurrency(undefined, 'EUR')).toBe('EUR');
    expect(defaultItemCurrency(null, 'EUR')).toBe('EUR');
    expect(defaultItemCurrency('', 'EUR')).toBe('EUR');
  });

  it('falls back to USD when neither is set', () => {
    expect(defaultItemCurrency()).toBe('USD');
    expect(defaultItemCurrency(null, null)).toBe('USD');
    expect(defaultItemCurrency('', '  ')).toBe('USD');
  });

  it('normalizes casing to the uppercase code the picker shows', () => {
    expect(defaultItemCurrency('pln', 'eur')).toBe('PLN');
    expect(defaultItemCurrency(' gbp ')).toBe('GBP');
    expect(defaultItemCurrency(undefined, 'eur')).toBe('EUR');
  });

  it("skips a code the picker doesn't offer instead of starting on it", () => {
    expect(defaultItemCurrency('XYZ', 'EUR')).toBe('EUR');
    expect(defaultItemCurrency('XYZ', 'ABC')).toBe('USD');
  });

  it('always returns an offered code', () => {
    const codes = new Set(CURRENCY_OPTIONS.map((c) => c.code));
    for (const [w, u] of [
      ['PLN', 'EUR'],
      [null, 'jpy'],
      ['nope', undefined],
      [undefined, undefined],
    ] as const) {
      expect(codes.has(defaultItemCurrency(w, u))).toBe(true);
    }
  });
});
