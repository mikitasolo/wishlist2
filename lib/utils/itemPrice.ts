import { convertToUsdCents } from '@/lib/utils/currencyRates';

/**
 * The `priceInUsdCents` every item response carries: the item's price converted
 * to USD cents with the current rates, so the price sorts compare one currency.
 * Null when the item has no price (a zero value counts as none) or no rate is
 * known for its currency, which sorts it with the unpriced items.
 *
 * The list reads and the create/edit responses all go through this, so a new or
 * re-priced item sorts the same way before and after the next poll. It sits
 * apart from `currencyRates.ts` so route tests that mock that module (to stub
 * the rates fetch) don't each have to stub this too.
 */
export function itemPriceInUsdCents(
  price: { value: number; currency: string } | null | undefined,
  rates: Map<string, number>
): number | null {
  if (!price?.value || !price.currency) return null;
  return convertToUsdCents(price.value, price.currency, rates);
}
