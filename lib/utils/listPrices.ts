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
 *   their own lists and for other people's, in this browser only. Picking
 *   their own currency ("· your default") is remembered as that, not as its
 *   code, so it follows a new default set in Settings.
 *
 * The control is only offered when it changes something: when some priced item
 * isn't in the viewer's currency (the list mixes currencies, or is in another
 * one), and once the exchange rates have loaded (without them nothing can be
 * converted, and a control naming a currency the cards aren't in would say
 * otherwise). Without it, prices show in their own currency.
 *
 * Currency codes are compared uppercase: `Item.price.currency` is stored
 * lowercase, `User.defaultCurrency` uppercase.
 */
import { isOfferedCurrency } from '@/lib/utils/currencies';

/** The Prices value that shows each price in its own currency. */
export const ORIGINAL_PRICES = 'original';

/** How a pick of the viewer's own currency is stored, so it follows their default. */
const VIEWER_CURRENCY_CHOICE = 'mine';

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

/** Whether `value` can be stored as a pick. */
function isStoredValue(value: unknown): value is string {
  return (
    value === ORIGINAL_PRICES ||
    value === VIEWER_CURRENCY_CHOICE ||
    (typeof value === 'string' && isOfferedCurrency(value))
  );
}

/** Where a viewer's pick is kept: one key per account and context. */
export function pricesChoiceKey(userId: string, context: PricesContext): string {
  return `wishlist-prices-choice:${userId}:${context}`;
}

/**
 * The viewer's remembered pick for this context, as a Prices value (their own
 * currency as it is now, if that's what they picked), or null for none, or for
 * one no longer offered.
 */
export function savedPricesChoice(
  storage: Pick<Storage, 'getItem'>,
  userId: string,
  context: PricesContext,
  viewerCurrency: string
): string | null {
  const stored = storage.getItem(pricesChoiceKey(userId, context));
  if (stored === VIEWER_CURRENCY_CHOICE) return viewerCurrency.toUpperCase();
  return isStoredValue(stored) ? stored : null;
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
  const stored = value === viewerCurrency.toUpperCase() ? VIEWER_CURRENCY_CHOICE : value;
  if (value === defaultPricesChoice(context, viewerCurrency) || !isStoredValue(stored)) {
    storage.removeItem(key);
  } else {
    storage.setItem(key, stored);
  }
}
