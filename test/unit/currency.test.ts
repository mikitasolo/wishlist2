import { describe, it, expect } from 'vitest';
import {
  PRICE_FALLBACK_LOCALE,
  convertPrice,
  convertedPrice,
  currencySymbol,
  formatApproxPrice,
  formatPrice,
  formatPriceInput,
  hasRate,
  normalizeCurrency,
  parsePriceInput,
  rateKey,
} from '@/lib/utils/currency';

// WIS-49: codes are stored uppercase, but item prices (and their snapshots)
// written before it are lowercase until the `uppercase-currency-codes`
// migration has run, so every helper takes either casing.
describe('normalizeCurrency', () => {
  it('trims and uppercases a code, whatever its casing', () => {
    expect(normalizeCurrency('eur')).toBe('EUR');
    expect(normalizeCurrency(' Pln ')).toBe('PLN');
    expect(normalizeCurrency('USD')).toBe('USD');
  });

  it('falls back to USD when there is no code', () => {
    expect(normalizeCurrency(null)).toBe('USD');
    expect(normalizeCurrency(undefined)).toBe('USD');
    expect(normalizeCurrency('')).toBe('USD');
    expect(normalizeCurrency('   ')).toBe('USD');
  });

  it('makes both casings of a code compare equal', () => {
    expect(normalizeCurrency('eur')).toBe(normalizeCurrency('EUR'));
  });
});

describe('rates lookups take either casing', () => {
  const rates = new Map([
    ['usd', 1],
    ['eur', 0.88],
  ]);

  it('keys a code the way the rates map does: lowercase', () => {
    expect(rateKey('EUR')).toBe('eur');
    expect(rateKey(' eur ')).toBe('eur');
  });

  it('finds a rate for an uppercase or a lowercase code', () => {
    expect(hasRate(rates, 'EUR')).toBe(true);
    expect(hasRate(rates, 'eur')).toBe(true);
    expect(hasRate(rates, 'USD')).toBe(true);
    expect(hasRate(rates, 'JPY')).toBe(false);
  });
});

// Intl separates some locales' digits from their symbol with a no-break space
// (U+00A0) or a narrow one (U+202F): compare with plain spaces.
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

describe('formatPrice', () => {
  // regression: cards printed `${CODE} ${toFixed(2)}` ("EUR 349.00", "PLN
  // 12000.00"), with no locale and no thousands separator, while the item
  // dialog showed the browser's own decimal format ("349,00").
  it('regression: formats a price in the given locale, with its currency’s symbol and grouping', () => {
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

  it('shows two decimals for a currency with more, since a price has no more than that', () => {
    expect(plain(formatPrice({ value: 34900, currency: 'kwd' }, 'en-US'))).toBe('KWD 349.00');
  });

  it('always uses Latin digits, so the price field can read back what it shows', () => {
    expect(formatPrice({ value: 34900, currency: 'eur' }, 'ar-EG')).toMatch(/349\.00/);
  });

  it('shows a code Intl refuses as it is, and falls back from a locale it can’t use', () => {
    expect(formatPrice({ value: 500, currency: 'euro' }, 'en-US')).toBe('EURO 5.00');
    expect(formatPrice({ value: 500, currency: 'eur' }, 'not a locale!')).toBe('€5.00');
  });

  it('takes a price with no currency as USD, as it always has', () => {
    expect(formatPrice({ value: 100 } as { value: number; currency: string }, 'en-US')).toBe(
      '$1.00'
    );
  });
});

describe('formatApproxPrice', () => {
  it('marks a converted price with ≈ and rounds it to the whole unit', () => {
    expect(plain(formatApproxPrice({ value: 24654, currency: 'eur' }, 'en-US'))).toBe('≈ €247');
    expect(plain(formatApproxPrice({ value: 24654, currency: 'eur' }, 'de-DE'))).toBe('≈ 247 €');
    expect(plain(formatApproxPrice({ value: 1234567, currency: 'pln' }, 'en-US'))).toBe(
      '≈ PLN 12,346'
    );
    expect(plain(formatApproxPrice({ value: 1049, currency: 'eur' }, 'en-US'))).toBe('≈ €10');
  });

  it('keeps the cents below ten units, where a rounded unit would be far off', () => {
    expect(plain(formatApproxPrice({ value: 149, currency: 'eur' }, 'en-US'))).toBe('≈ €1.49');
    expect(plain(formatApproxPrice({ value: 45, currency: 'eur' }, 'en-US'))).toBe('≈ €0.45');
  });

  it('shows a zero as it is: it converts exactly', () => {
    expect(formatApproxPrice({ value: 0, currency: 'eur' }, 'en-US')).toBe('€0.00');
  });

  it('keeps ≈ on the same line as the amount', () => {
    expect(formatApproxPrice({ value: 24654, currency: 'eur' }, 'en-US')).toBe('≈\u00a0€247');
  });
});

describe('convertedPrice', () => {
  // 1 USD = 0.88 EUR, 1 USD = 4 PLN
  const rates = { eur: 0.88, pln: 4 };
  const usd279 = { value: 27900, currency: 'usd' };

  // regression: with an uppercase pick and a lowercase stored price (or the
  // reverse), the price is already in that currency, so it isn't "converted".
  it('is null for a price already in the picked currency, in either casing', () => {
    expect(convertedPrice({ value: 500, currency: 'eur' }, 'EUR', rates)).toBeNull();
    expect(convertedPrice({ value: 500, currency: 'EUR' }, 'eur', rates)).toBeNull();
    expect(convertedPrice({ value: 500, currency: 'EUR' }, 'EUR', rates)).toBeNull();
  });

  it('converts to the picked currency', () => {
    expect(convertedPrice(usd279, 'EUR', rates)).toEqual({ value: 24552, currency: 'EUR' });
  });

  it('is null for "original", without rates, or without a rate: the price shows as it is', () => {
    expect(convertedPrice(usd279, 'original', rates)).toBeNull();
    expect(convertedPrice(usd279, 'EUR', null)).toBeNull();
    expect(convertedPrice(usd279, 'GBP', rates)).toBeNull();
  });

  it('is null for a price already in the picked currency, whatever the casing', () => {
    expect(convertedPrice({ value: 1000, currency: 'pln' }, 'PLN', rates)).toBeNull();
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
    // de-CH groups with an apostrophe: ’ or ', depending on the ICU version.
    expect(formatPriceInput(123450, 'chf', 'de-CH')).toMatch(/^1['’]234\.50$/);
    expect(formatPriceInput(0, 'eur', 'en-US')).toBe('0.00');
    expect(formatPriceInput(100000, 'jpy', 'en-US')).toBe('1,000');
    expect(formatPriceInput(123400, 'jpy', 'de-DE')).toBe('1.234');
  });

  it('writes no more than two decimals, whatever the currency', () => {
    expect(formatPriceInput(34900, 'kwd', 'en-US')).toBe('349.00');
    expect(formatPriceInput(34900, 'clf', 'en-US')).toBe('349.00');
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
    'not a locale!',
  ])('is always read back, in the same locale, as the same cents (%s)', (locale) => {
    for (const [cents, currency] of [
      [123456789, 'eur'],
      [34900, 'usd'],
      [1234500, 'inr'],
      [100050, 'jpy'],
      [123400, 'jpy'],
      [34900, 'kwd'],
      [34900, 'clf'],
      [5, 'pln'],
      [500, 'euro'],
    ] as const) {
      const text = formatPriceInput(cents, currency, locale);
      expect(parsePriceInput(text, locale)).toEqual({ ok: true, cents });
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
    ['1\u202f234,50', 123450],
    ['1,23,456.00', 12345600],
    ['349,00', 34900],
    ['349.00', 34900],
    ['349', 34900],
    ['349,5', 34950],
    ['12,', 1200],
    ['.5', 50],
    ['0', 0],
    ['0,00', 0],
    ['1,234,567', 123456700],
    ['1.000.000,00', 100000000],
    ['  349,00 ', 34900],
    ['€349,00', 34900],
    ['$ 1,234.50', 123450],
    ['349,00 €', 34900],
  ])('reads %j as %d cents, in any locale', (text, cents) => {
    for (const locale of ['en-US', 'de-DE']) {
      expect(parsePriceInput(text, locale)).toEqual({ ok: true, cents });
    }
  });

  it('reads an empty field as no price', () => {
    expect(parsePriceInput('')).toEqual({ ok: true, cents: null });
    expect(parsePriceInput('   ')).toEqual({ ok: true, cents: null });
  });

  // Read without the locale, "1.999" (a typo for 1.99, say) would be 1999.00,
  // saved at 1000 times the price meant, where the number field this replaced
  // refused it.
  it('reads one separator before three digits as the locale writes numbers', () => {
    // Grouping where it isn't the locale's decimal separator...
    expect(parsePriceInput('1,234', 'en-US')).toEqual({ ok: true, cents: 123400 });
    expect(parsePriceInput('1.234', 'de-DE')).toEqual({ ok: true, cents: 123400 });
    // ...and three decimals, refused, where it is.
    expect(parsePriceInput('1.999', 'en-US')).toEqual({ ok: false });
    expect(parsePriceInput('1,999', 'de-DE')).toEqual({ ok: false });
    // The fixed fallback locale when given none.
    expect(parsePriceInput('1.999')).toEqual({ ok: false });
  });

  it.each([
    'abc',
    '-5',
    '1e5',
    '12.345,678',
    '0.123',
    '0,123',
    '12.345.67',
    '1.2.3',
    '1,2,3',
    '12,3456',
    '1 000.000,00',
    '.',
    ',',
    '349 PLN',
    '99999999999999999',
    // A sign is only ignored at either end, and never the cent sign.
    '50¢',
    '5$5',
    '1€234',
  ])('refuses %j', (text) => {
    for (const locale of ['en-US', 'de-DE']) {
      expect(parsePriceInput(text, locale)).toEqual({ ok: false });
    }
  });
});

describe('convertPrice (client-side, rates = units per USD)', () => {
  // 1 USD = 4 PLN, 1 USD = 0.5 EUR
  const rates = { pln: 4, eur: 0.5 };

  it('returns the same value when source === target', () => {
    expect(convertPrice({ value: 400, currency: 'pln' }, 'pln', rates)).toEqual({
      value: 400,
      currency: 'PLN',
    });
  });

  it('converts a non-USD price to USD', () => {
    // 400 grosz (4 PLN) → 100 US cents ($1.00)
    expect(convertPrice({ value: 400, currency: 'pln' }, 'usd', rates)).toEqual({
      value: 100,
      currency: 'USD',
    });
  });

  it('converts USD to a non-USD currency', () => {
    // $1.00 → 4 PLN (400 grosz)
    expect(convertPrice({ value: 100, currency: 'usd' }, 'pln', rates)).toEqual({
      value: 400,
      currency: 'PLN',
    });
  });

  it('converts between two non-USD currencies via USD', () => {
    // 4 PLN → $1 → 0.5 EUR (50 euro cents)
    expect(convertPrice({ value: 400, currency: 'pln' }, 'eur', rates)).toEqual({
      value: 50,
      currency: 'EUR',
    });
  });

  it('converts the same with either casing of the input, and answers uppercase', () => {
    for (const [from, to] of [
      ['pln', 'eur'],
      ['PLN', 'EUR'],
      ['pln', 'EUR'],
      ['PLN', 'eur'],
    ]) {
      expect(convertPrice({ value: 400, currency: from }, to, rates)).toEqual({
        value: 50,
        currency: 'EUR',
      });
    }
  });

  it('is case-insensitive on currency codes', () => {
    expect(convertPrice({ value: 400, currency: 'PLN' }, 'USD', rates)).toEqual({
      value: 100,
      currency: 'USD',
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
