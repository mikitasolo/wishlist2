import { describe, it, expect } from 'vitest';
import {
  PRICE_FALLBACK_LOCALE,
  convertPrice,
  currencySymbol,
  formatApproxPrice,
  formatPrice,
  formatPriceInput,
  parsePriceInput,
  priceToShow,
} from '@/lib/utils/currency';

// Intl separates some locales' digits from their symbol with a no-break space
// (U+00A0) or a narrow one (U+202F): compare with plain spaces.
const plain = (text: string) => text.replace(/[  ]/g, ' ');

describe('formatPrice', () => {
  // regression: cards printed `${CODE} ${toFixed(2)}` ("EUR 349.00", "PLN
  // 12000.00"), with no locale and no thousands separator, while the item
  // dialog showed the browser's own decimal format ("349,00").
  it('formats a price in the given locale, with its currency’s symbol and grouping', () => {
    expect(formatPrice({ value: 34900, currency: 'eur' }, 'en-US')).toBe('€349.00');
    expect(plain(formatPrice({ value: 34900, currency: 'eur' }, 'de-DE'))).toBe('349,00 €');
    expect(plain(formatPrice({ value: 1200000, currency: 'pln' }, 'en-US'))).toBe('PLN 12,000.00');
    expect(plain(formatPrice({ value: 1200000, currency: 'pln' }, 'pl-PL'))).toBe('12 000,00 zł');
    expect(plain(formatPrice({ value: 123450, currency: 'eur' }, 'fr-FR'))).toBe('1 234,50 €');
    expect(formatPrice({ value: 9999, currency: 'usd' }, 'en-US')).toBe('$99.99');
    expect(formatPrice({ value: 12345600, currency: 'inr' }, 'en-IN')).toBe('₹1,23,456.00');
  });

  it('reads the currency code in either case (items are lowercase, lists uppercase)', () => {
    expect(formatPrice({ value: 1250, currency: 'GBP' }, 'en-US')).toBe('£12.50');
    expect(formatPrice({ value: 1250, currency: 'gbp' }, 'en-US')).toBe('£12.50');
  });

  it('formats in the fixed fallback locale when given none (a server render, a share card)', () => {
    expect(PRICE_FALLBACK_LOCALE).toBe('en-US');
    expect(formatPrice({ value: 34900, currency: 'eur' })).toBe('€349.00');
  });

  it('shows a zero price', () => {
    expect(formatPrice({ value: 0, currency: 'usd' }, 'en-US')).toBe('$0.00');
  });

  it('uses the currency’s own decimals, but never hides cents', () => {
    expect(formatPrice({ value: 100000, currency: 'jpy' }, 'en-US')).toBe('¥1,000');
    // A price is exact: ¥1,000.50 is not rounded to ¥1,001.
    expect(formatPrice({ value: 100050, currency: 'jpy' }, 'en-US')).toBe('¥1,000.50');
  });

  it('always uses Latin digits, so the price field can read back what it shows', () => {
    expect(formatPrice({ value: 34900, currency: 'eur' }, 'ar-EG')).toMatch(/349\.00/);
  });

  it('shows a code Intl refuses as it is, and falls back from a locale it can’t use', () => {
    expect(formatPrice({ value: 500, currency: 'euro' }, 'en-US')).toBe('EURO 5.00');
    expect(formatPrice({ value: 500, currency: 'eur' }, 'not a locale!')).toBe('€5.00');
  });
});

describe('formatApproxPrice', () => {
  it('marks a converted price with ≈ and rounds it to the whole unit', () => {
    expect(plain(formatApproxPrice({ value: 24654, currency: 'eur' }, 'en-US'))).toBe('≈ €247');
    expect(plain(formatApproxPrice({ value: 24654, currency: 'eur' }, 'de-DE'))).toBe('≈ 247 €');
    expect(plain(formatApproxPrice({ value: 1234567, currency: 'pln' }, 'en-US'))).toBe(
      '≈ PLN 12,346'
    );
  });

  it('keeps the cents below one unit, rather than round it to nothing', () => {
    expect(plain(formatApproxPrice({ value: 45, currency: 'eur' }, 'en-US'))).toBe('≈ €0.45');
  });

  it('keeps ≈ on the same line as the amount', () => {
    expect(formatApproxPrice({ value: 24654, currency: 'eur' }, 'en-US')).toBe('≈ €247');
  });
});

describe('priceToShow', () => {
  // 1 USD = 0.88 EUR, 1 USD = 4 PLN
  const rates = { eur: 0.88, pln: 4 };
  const usd279 = { value: 27900, currency: 'usd' };

  it('converts to the picked currency, keeping the original to show under it', () => {
    expect(priceToShow(usd279, 'EUR', rates)).toEqual({
      price: usd279,
      converted: { value: 24552, currency: 'eur' },
    });
  });

  it('shows the price as it is for "original", without rates, or without a rate', () => {
    expect(priceToShow(usd279, 'original', rates)).toEqual({ price: usd279, converted: null });
    expect(priceToShow(usd279, 'EUR', null)).toEqual({ price: usd279, converted: null });
    expect(priceToShow(usd279, 'GBP', rates)).toEqual({ price: usd279, converted: null });
  });

  it('shows a price already in the picked currency exactly, whatever the casing', () => {
    const pln = { value: 1000, currency: 'pln' };
    expect(priceToShow(pln, 'PLN', rates)).toEqual({ price: pln, converted: null });
  });
});

describe('currencySymbol', () => {
  it('is the symbol the locale writes the currency with', () => {
    expect(currencySymbol('eur', 'en-US')).toBe('€');
    expect(currencySymbol('USD', 'en-US')).toBe('$');
    expect(currencySymbol('pln', 'en-US')).toBe('PLN');
    expect(currencySymbol('pln', 'pl-PL')).toBe('zł');
  });

  it('falls back to the code for one Intl refuses', () => {
    expect(currencySymbol('euro', 'en-US')).toBe('EURO');
  });
});

describe('formatPriceInput', () => {
  it('is the number the card shows, without the symbol', () => {
    expect(formatPriceInput(34900, 'eur', 'en-US')).toBe('349.00');
    expect(formatPriceInput(34900, 'eur', 'de-DE')).toBe('349,00');
    expect(formatPriceInput(123450, 'usd', 'en-US')).toBe('1,234.50');
    expect(plain(formatPriceInput(123450, 'eur', 'fr-FR'))).toBe('1 234,50');
    expect(formatPriceInput(123450, 'chf', 'de-CH')).toBe('1’234.50');
    expect(formatPriceInput(0, 'eur', 'en-US')).toBe('0.00');
    expect(formatPriceInput(100000, 'jpy', 'en-US')).toBe('1,000');
  });

  it.each([
    'en-US',
    'de-DE',
    'fr-FR',
    'de-CH',
    'en-IN',
    'pl-PL',
    'es-ES',
    'ar-EG',
    'fa-IR',
    'hi-IN',
  ])('is always read back as the same cents (%s)', (locale) => {
    for (const [cents, currency] of [
      [123456789, 'eur'],
      [34900, 'usd'],
      [1234500, 'inr'],
      [100050, 'jpy'],
      [5, 'pln'],
    ] as const) {
      const text = formatPriceInput(cents, currency, locale);
      expect(parsePriceInput(text)).toEqual({ ok: true, cents });
    }
  });
});

describe('parsePriceInput', () => {
  it.each([
    ['1 234,50', 123450],
    ['1,234.50', 123450],
    ['1.234,50', 123450],
    ["1'234.50", 123450],
    ['1’234.50', 123450],
    ['1 234,50', 123450],
    ['1,23,456.00', 12345600],
    ['349,00', 34900],
    ['349.00', 34900],
    ['349', 34900],
    ['349,5', 34950],
    ['12,', 1200],
    ['.5', 50],
    ['0', 0],
    ['0,00', 0],
    ['1,234', 123400],
    ['1.234', 123400],
    ['1,234,567', 123456700],
    ['1.000.000,00', 100000000],
    ['  349,00 ', 34900],
    ['€349,00', 34900],
    ['$ 1,234.50', 123450],
  ])('reads %j as %d cents', (text, cents) => {
    expect(parsePriceInput(text)).toEqual({ ok: true, cents });
  });

  it('reads an empty field as no price', () => {
    expect(parsePriceInput('')).toEqual({ ok: true, cents: null });
    expect(parsePriceInput('   ')).toEqual({ ok: true, cents: null });
  });

  it.each([
    'abc',
    '-5',
    '1e5',
    '12.345,678',
    '0.123',
    '12.345.67',
    '1.2.3',
    '1,2,3',
    '12,3456',
    '1 000.000,00',
    '.',
    ',',
    '349 PLN',
    '99999999999999999',
  ])('refuses %j', (text) => {
    expect(parsePriceInput(text)).toEqual({ ok: false });
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
