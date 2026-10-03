/**
 * Prices for people: formatting, converting between currencies, and reading an
 * amount someone typed.
 *
 * A price is an integer number of cents (hundredths of the unit, whatever the
 * currency) and a currency code. Code casing isn't uniform in the DB (an item's
 * is lowercase, a list's and a user's uppercase), so every helper here takes
 * either and normalizes it.
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
  /** ISO 4217 code, either case. */
  currency: string;
}

/**
 * The locale prices are formatted in wherever the viewer's isn't known: a
 * server render, the render that hydrates it, a share card.
 */
export const PRICE_FALLBACK_LOCALE = 'en-US';

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * A cached `Intl.NumberFormat`, or `null` when `currency` isn't a well-formed
 * code (the API takes any non-empty one). A locale the runtime can't use falls
 * back to `PRICE_FALLBACK_LOCALE`.
 */
function numberFormat(
  locale: string,
  currency: string | null,
  fractionDigits: { min?: number; max?: number } = {}
): Intl.NumberFormat | null {
  const key = `${locale}|${currency}|${fractionDigits.min}|${fractionDigits.max}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  const options: Intl.NumberFormatOptions = {
    numberingSystem: 'latn',
    ...(currency ? { style: 'currency', currency } : {}),
    minimumFractionDigits: fractionDigits.min,
    maximumFractionDigits: fractionDigits.max,
  };
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat(locale, options);
  } catch {
    try {
      format = new Intl.NumberFormat(PRICE_FALLBACK_LOCALE, options);
    } catch {
      return null; // a malformed currency code
    }
  }
  formatters.set(key, format);
  return format;
}

/**
 * How many decimals an exact price shows: its currency's own (two for EUR, none
 * for JPY), but two whenever the amount has cents the currency's own would hide,
 * so "exact" never rounds.
 */
function exactDigits(price: Price, locale: string): { min?: number; max?: number } {
  const own = numberFormat(locale, price.currency.toUpperCase())?.resolvedOptions();
  if (own && (own.maximumFractionDigits ?? 2) < 2 && price.value % 100 !== 0) {
    return { min: 2, max: 2 };
  }
  return {};
}

/** "EUR 349.00": what a code no `Intl` currency format accepts gets. */
function plainPrice(price: Price, locale: string): string {
  const amount = numberFormat(locale, null, { min: 2, max: 2 })!.format(price.value / 100);
  return `${price.currency.toUpperCase()} ${amount}`;
}

/**
 * A price, exactly: "€349.00", "349,00 €", "PLN 12,000.00", "¥1,000". Its
 * currency's own symbol and decimals, in `locale` (see the module comment for
 * which). A malformed currency code is shown as it is ("EURO 5.00").
 */
export function formatPrice(price: Price, locale: string = PRICE_FALLBACK_LOCALE): string {
  const format = numberFormat(locale, price.currency.toUpperCase(), exactDigits(price, locale));
  return format ? format.format(price.value / 100) : plainPrice(price, locale);
}

/**
 * A converted price, which is only as good as the day's rate: "≈ €247", to the
 * whole unit (below one unit, exactly: "≈ €0.45"). Show the original price
 * next to it (see `priceToShow`).
 */
export function formatApproxPrice(price: Price, locale: string = PRICE_FALLBACK_LOCALE): string {
  if (Math.abs(price.value) < 100) return `≈ ${formatPrice(price, locale)}`;
  const format = numberFormat(locale, price.currency.toUpperCase(), { min: 0, max: 0 });
  const amount = format
    ? format.format(price.value / 100)
    : `${price.currency.toUpperCase()} ${Math.round(price.value / 100)}`;
  return `≈ ${amount}`;
}

/**
 * The currency's symbol in `locale`, as the price input's prefix: "€", "$",
 * "PLN" (en-US) or "zł" (pl-PL). A malformed code comes back uppercased.
 */
export function currencySymbol(currency: string, locale: string = PRICE_FALLBACK_LOCALE): string {
  const code = currency.toUpperCase();
  const part = numberFormat(locale, code)
    ?.formatToParts(0)
    .find((p) => p.type === 'currency');
  return part?.value ?? code;
}

/**
 * An amount in cents as the price input shows it: the number of
 * `formatPrice`'s output with no symbol, so the field and the card agree
 * ("349,00" in de-DE, "1,234.50" in en-US). Always something
 * `parsePriceInput` reads back as the same cents: a locale whose format it
 * couldn't read gets the fallback locale's.
 */
export function formatPriceInput(
  cents: number,
  currency: string,
  locale: string = PRICE_FALLBACK_LOCALE
): string {
  const price = { value: cents, currency };
  const numberOnly = (loc: string) => {
    const format =
      numberFormat(loc, currency.toUpperCase(), exactDigits(price, loc)) ??
      numberFormat(loc, null, { min: 2, max: 2 })!;
    return format
      .formatToParts(cents / 100)
      .filter((p) => ['integer', 'group', 'decimal', 'fraction'].includes(p.type))
      .map((p) => p.value)
      .join('');
  };
  const text = numberOnly(locale);
  const read = parsePriceInput(text);
  return read.ok && read.cents === cents ? text : numberOnly(PRICE_FALLBACK_LOCALE);
}

export type ParsedPriceInput = { ok: true; cents: number | null } | { ok: false };

// Spaces of every width (a plain one, the no-break and narrow no-break spaces
// fr-FR groups with) and apostrophes (de-CH groups with ’) only ever group digits.
const GROUP_ONLY = /[\s'’ʼ]/g;
const CURRENCY_SIGN = /\p{Sc}/gu;
// Left-to-right and right-to-left marks some locales put around a number.
const BIDI_MARK = /[‎‏؜‪-‮⁦-⁩]/g;

/**
 * Reads an amount someone typed into the price input, in cents. Either "," or
 * "." may be the decimal separator, whatever the locale: "349,00", "349.00",
 * "1 234,50", "1,234.50", "1.234,50", "1'234.50" and "1,23,456.00" (en-IN) all
 * read as you'd expect. With both, the last one is the decimal separator. One
 * on its own followed by exactly three digits groups thousands ("1,234" is
 * 1234.00), since a price has at most two decimals; otherwise it's the decimal
 * separator. Grouped digits must be grouped properly (threes, or en-IN's twos).
 * A currency sign is ignored.
 *
 * `{ ok: true, cents: null }` for an empty field (no price), `{ ok: false }` for
 * anything else that isn't an amount of zero or more with at most two decimals:
 * a negative, letters, "1.2.3", "12.345,678".
 */
export function parsePriceInput(text: string): ParsedPriceInput {
  const invalid = { ok: false } as const;
  const input = text.replace(CURRENCY_SIGN, '').replace(BIDI_MARK, '').replace(GROUP_ONLY, ' ');
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, cents: null };
  if (!/^[\d., ]+$/.test(trimmed) || !/\d/.test(trimmed)) return invalid;

  const lastDot = trimmed.lastIndexOf('.');
  const lastComma = trimmed.lastIndexOf(',');
  let decimalAt = -1;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const at = Math.max(lastDot, lastComma);
    const only = trimmed.indexOf(trimmed[at]) === at;
    if (only && !/^\d{3}$/.test(trimmed.slice(at + 1))) decimalAt = at;
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
 * @param price - source price ({ value in cents, currency })
 * @param to - target currency code
 * @param rates - map of lowercase currency code → units per USD
 */
export function convertPrice(
  price: Price,
  to: string,
  rates: Record<string, number>
): { value: number; currency: string } | null {
  const from = price.currency.toLowerCase();
  const target = to.toLowerCase();
  if (from === target) return { value: price.value, currency: target };

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
  if (target === 'usd') return { value: Math.round(usdCents), currency: 'usd' };
  const rate = rates[target];
  if (!rate) return null;
  return { value: Math.round(usdCents * rate), currency: target };
}

/**
 * The price to show for `price` when the viewer picked `currency` ('original'
 * keeps each price's own): `converted` is set, with `price` as the original,
 * only when it really was converted. A price already in that currency, or one
 * with no rate yet (`rates` missing, or lacking either currency), is shown as
 * it is, exactly.
 */
export function priceToShow(
  price: Price,
  currency: string,
  rates: Record<string, number> | null
): { price: Price; converted: Price | null } {
  if (currency === 'original' || !rates) return { price, converted: null };
  const converted = convertPrice(price, currency, rates);
  if (!converted || converted.currency === price.currency.toLowerCase()) {
    return { price, converted: null };
  }
  return { price, converted };
}
