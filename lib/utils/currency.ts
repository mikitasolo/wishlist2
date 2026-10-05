/**
 * Prices for people: formatting, converting between currencies, and reading an
 * amount someone typed.
 *
 * A price is an integer number of cents (hundredths of the unit, whatever the
 * currency) and an uppercase ISO 4217 code. Codes are compared only through
 * `normalizeCurrency`, which also cleans up a code typed or sent by a client.
 *
 * Every price the app shows goes through `formatPrice` (or `formatApproxPrice`
 * for a converted one), in the viewer's locale: "€349.00" in en-US, "349,00 €"
 * in de-DE, "PLN 12,000.00" in en-US. In a component, take the locale from
 * `useViewerLocale` (`lib/hooks/useViewerLocale.ts`), which is the fixed
 * `PRICE_FALLBACK_LOCALE` in a server render and in the render that hydrates
 * it, so the server and the browser never format one price two ways. Code that
 * only runs on the server (a share card, an email) passes no locale and gets
 * that fixed one. Digits are always Latin (0-9), so the item form can read back
 * what it formatted (`parsePriceInput`).
 */

export interface Price {
  /** Cents: hundredths of the unit, in every currency. */
  value: number;
  /** ISO 4217 code: uppercase. */
  currency: string;
}

/**
 * The locale prices are formatted in wherever the viewer's isn't known: a
 * server render, the render that hydrates it, a share card.
 */
export const PRICE_FALLBACK_LOCALE = 'en-US';

/**
 * A currency code the way it's stored and compared: trimmed and uppercase
 * ("eur " → "EUR"), USD when there's none. Every comparison of two codes goes
 * through this, so a code a client sent in another casing still matches.
 */
export function normalizeCurrency(currency: string | null | undefined): string {
  return (currency || '').trim().toUpperCase() || 'USD';
}

/** A currency code as `Intl` takes it. */
const currencyCode = normalizeCurrency;

/**
 * The key `code` has in a rates map, whose keys are lowercase (the rates API's
 * format; see `ensureCurrencyRatesUpToDate`). Only the rates helpers use it.
 */
export function rateKey(currency: string): string {
  return normalizeCurrency(currency).toLowerCase();
}

/**
 * Whether the server's rates map knows `currency`, in either casing: what an
 * item's price must be in to be saved.
 */
export function hasRate(rates: Map<string, number>, currency: string): boolean {
  return rates.has(rateKey(currency));
}

const formatters = new Map<string, Intl.NumberFormat | null>();

/**
 * A cached `Intl.NumberFormat` with Latin digits, or `null` when `currency`
 * isn't a well-formed code (the API takes any non-empty one). A locale the
 * runtime can't use falls back to `PRICE_FALLBACK_LOCALE`.
 */
function numberFormat(
  locale: string,
  currency: string | null,
  fractionDigits: { min?: number; max?: number } = {}
): Intl.NumberFormat | null {
  const key = `${locale}|${currency}|${fractionDigits.min}|${fractionDigits.max}`;
  if (formatters.has(key)) return formatters.get(key)!;
  const options: Intl.NumberFormatOptions = {
    numberingSystem: 'latn',
    ...(currency ? { style: 'currency', currency } : {}),
    minimumFractionDigits: fractionDigits.min,
    maximumFractionDigits: fractionDigits.max,
  };
  let format: Intl.NumberFormat | null;
  try {
    format = new Intl.NumberFormat(locale, options);
  } catch {
    try {
      format = new Intl.NumberFormat(PRICE_FALLBACK_LOCALE, options);
    } catch {
      format = null; // a malformed currency code
    }
  }
  formatters.set(key, format);
  return format;
}

/** A plain number format, which every locale (or its fallback) has. */
function decimalFormat(locale: string, digits: number): Intl.NumberFormat {
  return numberFormat(locale, null, { min: digits, max: digits })!;
}

/**
 * How many decimals an exact price shows: its currency's own (two for EUR, none
 * for JPY), but two whenever the amount has cents the currency's own would
 * hide, so "exact" never rounds, and never more than two (KWD has three), since
 * a price has no more than that.
 */
function exactDigits(price: Price, locale: string): { min?: number; max?: number } {
  const own = numberFormat(locale, currencyCode(price.currency))?.resolvedOptions()
    .maximumFractionDigits;
  if (own === undefined) return {};
  if (own > 2 || (own < 2 && price.value % 100 !== 0)) return { min: 2, max: 2 };
  return {};
}

/**
 * A price, exactly: "€349.00", "349,00 €", "PLN 12,000.00", "¥1,000". Its
 * currency's own symbol and decimals, in `locale` (see the module comment for
 * which). A malformed currency code is shown as it is ("EURO 5.00").
 */
export function formatPrice(price: Price, locale: string = PRICE_FALLBACK_LOCALE): string {
  const code = currencyCode(price.currency);
  const format = numberFormat(locale, code, exactDigits(price, locale));
  if (format) return format.format(price.value / 100);
  return `${code} ${decimalFormat(locale, 2).format(price.value / 100)}`;
}

/**
 * A converted price, which is only as good as the day's rate: "≈ €247". From
 * ten units up it's rounded to the unit; below that, where a unit is a big
 * share of the price, to the cent ("≈ €4.99"). A zero converts exactly, so it
 * has no "≈". Show the original price with it (see `convertedPrice`).
 */
export function formatApproxPrice(price: Price, locale: string = PRICE_FALLBACK_LOCALE): string {
  if (price.value === 0) return formatPrice(price, locale);
  if (Math.abs(price.value) < 1000) return `≈\u00a0${formatPrice(price, locale)}`;
  const code = currencyCode(price.currency);
  const format = numberFormat(locale, code, { min: 0, max: 0 });
  const amount = format
    ? format.format(price.value / 100)
    : `${code} ${decimalFormat(locale, 0).format(price.value / 100)}`;
  return `≈\u00a0${amount}`;
}

/**
 * The currency's symbol in `locale`, as the price input's prefix: "€", "$",
 * "PLN" (en-US) or "zł" (pl-PL). A malformed code comes back uppercased.
 */
export function currencySymbol(currency: string, locale: string = PRICE_FALLBACK_LOCALE): string {
  const code = currencyCode(currency);
  const part = numberFormat(locale, code)
    ?.formatToParts(0)
    .find((p) => p.type === 'currency');
  return part?.value ?? code;
}

/**
 * An amount in cents as the price input shows it: the number of
 * `formatPrice`'s output with no symbol, so the field and the card agree
 * ("349,00" in de-DE, "1,234.50" in en-US). Always something
 * `parsePriceInput` reads back, in the same locale, as the same cents: should
 * a locale's own form ever not be, the field gets a plain "1234.50" instead,
 * which reads the same in every locale.
 */
export function formatPriceInput(
  cents: number,
  currency: string,
  locale: string = PRICE_FALLBACK_LOCALE
): string {
  const code = currencyCode(currency);
  const format =
    numberFormat(locale, code, exactDigits({ value: cents, currency: code }, locale)) ??
    decimalFormat(locale, 2);
  const text = format
    .formatToParts(cents / 100)
    .filter((p) => ['integer', 'group', 'decimal', 'fraction'].includes(p.type))
    .map((p) => p.value)
    .join('');
  const read = parsePriceInput(text, locale);
  return read.ok && read.cents === cents ? text : (cents / 100).toFixed(2);
}

const decimalSeparators = new Map<string, string>();

/** The decimal separator `locale` writes numbers with: "." or ",". */
function decimalSeparator(locale: string): string {
  let separator = decimalSeparators.get(locale);
  if (separator === undefined) {
    separator =
      decimalFormat(locale, 1)
        .formatToParts(1.5)
        .find((p) => p.type === 'decimal')?.value ?? '.';
    decimalSeparators.set(locale, separator);
  }
  return separator;
}

export type ParsedPriceInput = { ok: true; cents: number | null } | { ok: false };

// Spaces of every width (a plain one, the no-break and narrow no-break spaces
// fr-FR groups with) and apostrophes (de-CH groups with ’) only ever group digits.
const GROUP_ONLY = /[\s'’ʼ]/g;
// A currency sign pasted along with the amount ("$1,234.50", "349,00 €"), but
// only at either end, and never the cent sign: "50¢" isn't 50.00.
const LEADING_SIGN = /^\s*(?!¢)\p{Sc}/u;
const TRAILING_SIGN = /(?!¢)\p{Sc}\s*$/u;
// Left-to-right and right-to-left marks some locales put around a number.
const BIDI_MARK = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g;

/**
 * Reads an amount someone typed into the price input, in cents. Either "," or
 * "." may be the decimal separator, whatever the locale: "349,00", "349.00",
 * "1 234,50", "1,234.50", "1.234,50", "1'234.50" and "1,23,456.00" (en-IN) all
 * read as you'd expect. With both, the last one is the decimal separator; one
 * on its own followed by one or two digits is too. One on its own followed by
 * exactly three digits ("1.234") is read as `locale` writes numbers: as
 * grouping (1234.00) where that separator isn't its decimal one, and refused
 * where it is (in en-US, "1.234" is three decimals, which no price has), so a
 * typo is never read as 1000 times the price meant.
 * Grouped digits must be grouped properly (threes, or en-IN's twos). A currency
 * sign at either end is ignored.
 *
 * `{ ok: true, cents: null }` for an empty field (no price), `{ ok: false }` for
 * anything else that isn't an amount of zero or more with at most two decimals:
 * a negative, letters, "1.2.3", "12.345,678".
 */
export function parsePriceInput(
  text: string,
  locale: string = PRICE_FALLBACK_LOCALE
): ParsedPriceInput {
  const invalid = { ok: false } as const;
  const trimmed = text
    .replace(BIDI_MARK, '')
    .replace(LEADING_SIGN, '')
    .replace(TRAILING_SIGN, '')
    .replace(GROUP_ONLY, ' ')
    .trim();
  if (!trimmed) return { ok: true, cents: null };
  if (!/^[\d., ]+$/.test(trimmed) || !/\d/.test(trimmed)) return invalid;

  const lastDot = trimmed.lastIndexOf('.');
  const lastComma = trimmed.lastIndexOf(',');
  let decimalAt = -1;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const at = Math.max(lastDot, lastComma);
    const separator = trimmed[at];
    const once = trimmed.indexOf(separator) === at;
    const groupsThousands =
      /^\d{3}$/.test(trimmed.slice(at + 1)) && separator !== decimalSeparator(locale);
    if (once && !groupsThousands) decimalAt = at;
  }

  const whole = decimalAt >= 0 ? trimmed.slice(0, decimalAt) : trimmed;
  const fraction = decimalAt >= 0 ? trimmed.slice(decimalAt + 1) : '';
  if (!/^\d{0,2}$/.test(fraction)) return invalid;

  const separators = new Set(whole.match(/[., ]/g) ?? []);
  if (separators.size > 1) return invalid;
  let digits = whole;
  if (separators.size === 1) {
    const groups = whole.split([...separators][0]);
    const middle = groups.slice(1, -1);
    if (
      !/^[1-9]\d{0,2}$/.test(groups[0]) ||
      !/^\d{3}$/.test(groups[groups.length - 1]) ||
      middle.some((group) => !/^\d{2,3}$/.test(group))
    ) {
      return invalid;
    }
    digits = groups.join('');
  }
  if (!/^\d*$/.test(digits) || (!digits && !fraction)) return invalid;

  const cents = Number(digits || '0') * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? { ok: true, cents } : invalid;
}

/**
 * Client-safe price conversion between currencies, routing through USD. Rates
 * are currency-per-USD (the shape returned by /api/currency-rates), matching the
 * server-side helpers. Returns null if a needed rate is missing.
 * @param price - source price ({ value in cents, currency in either casing })
 * @param to - target currency code, in either casing
 * @param rates - map of lowercase currency code → units per USD
 * @returns the price in `to`, its code uppercase
 */
export function convertPrice(
  price: Price,
  to: string,
  rates: Record<string, number>
): { value: number; currency: string } | null {
  const from = rateKey(price.currency);
  const target = rateKey(to);
  const currency = normalizeCurrency(to);
  if (from === target) return { value: price.value, currency };

  // Source → USD cents
  let usdCents: number;
  if (from === 'usd') {
    usdCents = price.value;
  } else {
    const rate = rates[from];
    if (!rate) return null;
    usdCents = price.value / rate;
  }

  // USD cents → target
  if (target === 'usd') return { value: Math.round(usdCents), currency };
  const rate = rates[target];
  if (!rate) return null;
  return { value: Math.round(usdCents * rate), currency };
}

/**
 * `price` in the currency the viewer picked ('original' keeps each price's
 * own), to show as approximate with the original under it: `null` when it
 * isn't converted, so the original is shown alone, exactly. That's a price
 * already in that currency, and one with no rate yet (`rates` missing, or
 * lacking either currency).
 */
export function convertedPrice(
  price: Price,
  currency: string,
  rates: Record<string, number> | null
): Price | null {
  if (currency === 'original' || !rates) return null;
  const converted = convertPrice(price, currency, rates);
  if (!converted || converted.currency === normalizeCurrency(price.currency)) return null;
  return converted;
}
