import { describe, it, expect } from 'vitest';
import {
  CURRENCY_OPTIONS,
  POPULAR_CURRENCIES,
  currencySelectOptions,
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

  it('select options are shaped { value, label } aligned with the option list', () => {
    expect(currencySelectOptions).toHaveLength(CURRENCY_OPTIONS.length);
    const usd = currencySelectOptions.find((o) => o.value === 'USD');
    expect(usd?.label).toContain('USD');
    expect(usd?.label).toContain('US Dollar');
  });
});
