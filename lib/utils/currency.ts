/**
 * Utility functions for currency formatting and conversion
 */

/**
 * Formats a price with currency symbol
 * @param value - Price value in cents (integer)
 * @param currency - Currency code (e.g., 'usd', 'eur')
 * @returns Formatted currency string (e.g., "$99.99", "€85.50") or "-" if no price
 */
export function formatPrice(value: number | null | undefined, currency: string = 'usd'): string {
  if (value == null) return '-';
  // Currency is stored in lowercase, convert to uppercase for display
  const currencyUpper = currency.toUpperCase();
  // Convert cents to dollars for display
  const dollars = value / 100;
  return `${currencyUpper} ${dollars.toFixed(2)}`;
}

/**
 * Formats a price object
 * @param price - Price object with value (in cents) and currency
 * @returns Formatted currency string
 */
export function formatPriceFromObject(
  price: { value: number; currency: string } | null | undefined
): string {
  if (!price) return '-';

  return formatPrice(price.value, price.currency);
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
  price: { value: number; currency: string },
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
