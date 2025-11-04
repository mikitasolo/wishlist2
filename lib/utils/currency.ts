/**
 * Utility functions for currency formatting and conversion
 */

/**
 * Converts cents to dollars and formats as currency string
 * @param cents - Price in cents (can be null/undefined)
 * @returns Formatted currency string (e.g., "$99.99") or "-" if no price
 */
export function formatPrice(cents: number | null | undefined): string {
  if (cents == null) return '-';
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Converts dollars to cents
 * @param dollars - Price in dollars as string or number
 * @returns Price in cents (rounded to nearest integer) or undefined if invalid
 */
export function dollarsToCents(dollars: string | number): number | undefined {
  if (dollars === '' || dollars === null || dollars === undefined) return undefined;
  const num = typeof dollars === 'string' ? parseFloat(dollars) : dollars;
  if (isNaN(num) || num < 0) return undefined;
  return Math.round(num * 100);
}

/**
 * Converts cents to dollars for display in forms
 * @param cents - Price in cents (can be null/undefined)
 * @returns Formatted string with 2 decimal places or empty string if no price
 */
export function centsToDollars(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

