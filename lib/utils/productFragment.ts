import { normalizeCurrency } from '@/lib/utils/currency';
import { isHttpUrl } from '@/lib/utils/itemFields';
import type { ProductData } from '@/lib/utils/productExtract';

/**
 * The hand-off from the bookmarklet (and a later extension) to `/items/new`
 * (WIS-365): the product travels in the URL's fragment, `#name=…&price=12.99
 * &currency=EUR&image=…&link=…`, never the query string, so it reaches neither
 * our server nor its logs. A fragment is never trusted: this validates every
 * field, and what's not usable is left out.
 */

/** What the add-item form starts from (`ItemPrefill`'s shape). */
export interface ProductPrefill {
  name: string;
  imageUrl?: string;
  price?: { value: number; currency: string };
  link?: string;
}

/** Matches the item name's cap (`createItemSchema`). */
export const FRAGMENT_NAME_MAX = 200;
/** A URL longer than this is dropped: the whole fragment also has to survive a sign-in redirect. */
export const FRAGMENT_URL_MAX = 1000;
/** The largest price taken, in cents: a garbage number can't become an absurd price. */
export const FRAGMENT_PRICE_MAX_CENTS = 1_000_000_000;

function httpUrl(raw: string | null): string | undefined {
  const value = raw?.trim();
  if (!value || value.length > FRAGMENT_URL_MAX || !isHttpUrl(value)) return undefined;
  return value;
}

/** "12.99" or "12" (major units, a dot for decimals) → cents; null for anything else. */
function priceToCents(raw: string | null): number | null {
  const value = raw?.trim();
  if (!value || !/^\d{1,9}(\.\d{1,2})?$/.test(value)) return null;
  const cents = Math.round(parseFloat(value) * 100);
  return cents > 0 && cents <= FRAGMENT_PRICE_MAX_CENTS ? cents : null;
}

/**
 * The product in a URL fragment (`location.hash`, with or without the `#`), or
 * null when it carries nothing usable (empty, garbage, or only rejected
 * fields): the page then opens the plain add flow, with no error. A link or
 * image that isn't http(s) is dropped (never `javascript:` or `data:`); a price
 * needs a three-letter currency alongside it (a currency is suggested, never
 * guessed); a name is whitespace-collapsed and capped.
 */
export function parseProductFragment(hash: string | null | undefined): ProductPrefill | null {
  const body = (hash ?? '').replace(/^#/, '');
  if (!body) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(body);
  } catch {
    return null;
  }
  const name = (params.get('name') ?? '').replace(/\s+/g, ' ').trim().slice(0, FRAGMENT_NAME_MAX);
  const imageUrl = httpUrl(params.get('image'));
  const link = httpUrl(params.get('link'));
  const cents = priceToCents(params.get('price'));
  const currencyRaw = params.get('currency')?.trim() ?? '';
  const price =
    cents != null && /^[a-z]{3}$/i.test(currencyRaw)
      ? { value: cents, currency: normalizeCurrency(currencyRaw) }
      : undefined;
  if (!name && !imageUrl && !link && !price) return null;
  return {
    name,
    ...(imageUrl && { imageUrl }),
    ...(price && { price }),
    ...(link && { link }),
  };
}

/** The fragment (with its `#`) for an extracted product: what the bookmarklet opens `/items/new` with. */
export function buildProductFragment(product: ProductData): string {
  const params = new URLSearchParams();
  if (product.name) params.set('name', product.name);
  if (product.price) {
    params.set('price', (product.price.cents / 100).toFixed(2));
    params.set('currency', product.price.currency);
  }
  if (product.imageUrl) params.set('image', product.imageUrl);
  params.set('link', product.link);
  return `#${params.toString()}`;
}
