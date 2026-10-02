/** Shared list of supported currencies (single source of truth for selects). */
export const CURRENCY_OPTIONS: { code: string; name: string }[] = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'PLN', name: 'Polish Zloty' },
  { code: 'BYN', name: 'Belarusian Ruble' },
  { code: 'RUB', name: 'Russian Ruble' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
];

export const POPULAR_CURRENCIES = ['USD', 'EUR', 'PLN', 'BYN', 'RUB'];

/** Options shaped for the shared <Select> component. */
export const currencySelectOptions = CURRENCY_OPTIONS.map((c) => ({
  value: c.code,
  label: `${c.code} · ${c.name}`,
}));

const OFFERED_CODES = new Set(CURRENCY_OPTIONS.map((c) => c.code));

/** Whether the currency pickers offer `code` (an uppercase code, e.g. "PLN"). */
export function isOfferedCurrency(code: string): boolean {
  return OFFERED_CODES.has(code);
}

/**
 * Settings' currency field, which focuses itself when Settings is opened at
 * it: where the dashboard's currency prompt sends "Choose another currency".
 */
export const SETTINGS_CURRENCY_FIELD_ID = 'currency';
export const SETTINGS_CURRENCY_PATH = `/settings#${SETTINGS_CURRENCY_FIELD_ID}`;

/**
 * The currency a new or proposed item starts on: the wishlist's own currency,
 * else the viewer's default, else USD.
 *
 * Returns the uppercase code the item form's picker shows (the form lowercases
 * it on submit to match `Item.price.currency`). Candidates are uppercased before
 * comparing, since currency-code casing isn't uniform across the DB. A code the
 * picker doesn't offer (the API accepts any three letters) is skipped, so a new
 * item never starts on a currency the user couldn't pick again.
 */
export function defaultItemCurrency(
  wishlistCurrency?: string | null,
  userCurrency?: string | null
): string {
  for (const candidate of [wishlistCurrency, userCurrency]) {
    const code = candidate?.trim().toUpperCase();
    if (code && isOfferedCurrency(code)) return code;
  }
  return 'USD';
}
