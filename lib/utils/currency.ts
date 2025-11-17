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
