/**
 * Which currency a list's prices are shown in (D9). Settings and the currency
 * prompt promise that other people's prices show in your default currency, so:
 *
 * - on someone else's list, Prices starts at the viewer's currency, and a
 *   price in another currency shows converted, as "≈" with the original small
 *   under it (`convertedPrice`, `formatApproxPrice`); one already in the
 *   viewer's currency shows exactly;
 * - on their own list, an owner starts on each item's own currency;
 * - a currency the viewer picks by hand is remembered for them, separately for
 *   their own lists and for other people's, in this browser only.
 *
 * The control is only offered when it changes something: when some priced item
 * isn't in the viewer's currency (the list mixes currencies, or is in another
 * one). Without it, prices show in their own currency, which is then the
 * viewer's anyway.
 *
 * Currency codes are compared uppercase: `Item.price.currency` is stored
 * lowercase, `User.defaultCurrency` uppercase.
 */
import { isOfferedCurrency } from '@/lib/utils/currencies';

/** The Prices value that shows each price in its own currency. */
export const ORIGINAL_PRICES = 'original';

/** Whose list it is, as far as the remembered choice goes. */
export type PricesContext = 'own' | 'others';

/** The viewer's currency, uppercase (an account starts on USD). */
export function viewerPriceCurrency(defaultCurrency: string | null | undefined): string {
  return (defaultCurrency || 'USD').toUpperCase();
}

/** Whether any priced item is in a currency other than the viewer's. */
export function needsPricesControl(
  items: Iterable<{ price?: { currency: string } | null }>,
  viewerCurrency: string
): boolean {
  const mine = viewerCurrency.toUpperCase();
  for (const { price } of items) {
    if (price?.currency && price.currency.toUpperCase() !== mine) return true;
  }
  return false;
}

/** Where Prices starts when the viewer hasn't picked anything. */
export function defaultPricesChoice(context: PricesContext, viewerCurrency: string): string {
  return context === 'own' ? ORIGINAL_PRICES : viewerCurrency.toUpperCase();
}

/** Whether `value` is something Prices offers. */
function isPricesValue(value: unknown): value is string {
  return value === ORIGINAL_PRICES || (typeof value === 'string' && isOfferedCurrency(value));
}

/** Where a viewer's pick is kept: one key per account and context. */
export function pricesChoiceKey(userId: string, context: PricesContext): string {
  return `wishlist-prices-choice:${userId}:${context}`;
}

/** The viewer's remembered pick for this context, or null for none (or one no longer offered). */
export function savedPricesChoice(
  storage: Pick<Storage, 'getItem'>,
  userId: string,
  context: PricesContext
): string | null {
  const stored = storage.getItem(pricesChoiceKey(userId, context));
  return isPricesValue(stored) ? stored : null;
}

/**
 * Remembers a pick. Picking the context's default forgets it instead, so the
 * viewer follows their default currency again if they change it in Settings.
 */
export function rememberPricesChoice(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  userId: string,
  context: PricesContext,
  value: string,
  viewerCurrency: string
): void {
  const key = pricesChoiceKey(userId, context);
  if (value === defaultPricesChoice(context, viewerCurrency) || !isPricesValue(value)) {
    storage.removeItem(key);
  } else {
    storage.setItem(key, value);
  }
}
