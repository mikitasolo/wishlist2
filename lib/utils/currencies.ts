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
