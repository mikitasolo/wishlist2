/**
 * The budget filter on someone else's list: "Under X", X in the viewer's own
 * currency, whatever currency each item is priced in. It's a view, like the
 * search and the status chips: not saved, and never changes a chip's count.
 *
 * Each price is converted exactly as the Prices control does (`convertPrice`),
 * and compared in integer cents against the limit, inclusively. An item that
 * can't be judged stays visible rather than being hidden by a guess: one with
 * no price, and one whose currency has no rate (or while no rates have
 * loaded). Currency codes are compared through `normalizeCurrency`.
 */
import { convertPrice, normalizeCurrency, parsePriceInput, type Price } from '@/lib/utils/currency';

/**
 * The limit the viewer typed, in cents: `null` for an empty field (no
 * filter), `'invalid'` for something that isn't an amount (also no filter,
 * but the field says so).
 */
export function parseBudget(text: string, locale?: string): number | null | 'invalid' {
  const read = parsePriceInput(text, locale);
  if (!read.ok) return 'invalid';
  return read.cents;
}

/** Whether `price` is within `limitCents` of `currency`, or can't be told. */
export function isWithinBudget(
  price: Price | null | undefined,
  limitCents: number,
  currency: string,
  rates: Record<string, number> | null
): boolean {
  if (!price) return true;
  if (normalizeCurrency(price.currency) === normalizeCurrency(currency)) {
    return price.value <= limitCents;
  }
  const converted = rates ? convertPrice(price, currency, rates) : null;
  return converted ? converted.value <= limitCents : true;
}

/** The items within the budget (all of them for no limit), in their order. */
export function filterByBudget<T extends { price?: Price | null }>(
  items: readonly T[],
  limitCents: number | null,
  currency: string,
  rates: Record<string, number> | null
): T[] {
  if (limitCents === null) return items as T[];
  return items.filter((item) => isWithinBudget(item.price, limitCents, currency, rates));
}

/** Whether some item has a price: without one, the filter has nothing to do. */
export function hasPricedItem(items: readonly { price?: Price | null }[]): boolean {
  return items.some((item) => !!item.price);
}
