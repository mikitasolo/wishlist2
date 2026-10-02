import type { ApiItem } from '@/types/api';
import { defaultItemCurrency } from '@/lib/utils/currencies';

/**
 * The item form (`components/ItemForm.tsx`, behind the add, edit, propose and
 * review modals), and what an edit of an item sends.
 *
 * Co-owners can edit one item at the same time, and the edit form is filled
 * when it opens, so by the time it's saved a co-owner may have changed the item.
 * An edit therefore sends only the fields the owner changed from the item as the
 * form was last filled from it (`itemChanges`): one they didn't touch stays out
 * of the write, so it can't undo a co-owner's change made meanwhile. Above all
 * the image: the one the form loaded, sent back over a co-owner's replacement,
 * would restore an image that replacement has already freed and free theirs (or
 * be refused as an upload of someone else's).
 */

/**
 * The form's fields as typed: the price is the amount in units, as text (`''`
 * for none), and the currency the uppercase code the picker shows.
 */
export interface ItemFormData {
  name: string;
  imageUrl: string;
  price: string;
  currency: string;
  link: string;
  notes: string;
  mostWanted: boolean;
  isDraft: boolean;
}

/**
 * An item's content as an edit sends it, and as the server stores it: no image,
 * link or notes is `null`, and the price is in cents with its currency
 * lowercase (to match `Item.price.currency`), or `null` for none.
 */
export interface ItemContent {
  name: string;
  imageUrl: string | null;
  price: { value: number; currency: string } | null;
  link: string | null;
  notes: string | null;
  mostWanted: boolean;
}

/** What an edit sends: only the content the owner changed. */
export type ItemContentChanges = Partial<ItemContent>;

/**
 * The form filled from an item. An item with a price keeps its own currency; a
 * priceless one starts on `defaultCurrency` (see defaultItemCurrency), so a
 * price added while editing or reviewing it lands in the wishlist's currency
 * rather than USD. Being part of the form's initial data, that prefill never
 * reads as an unsaved change.
 */
export function itemToFormData(
  item: Pick<ApiItem, 'name' | 'imageUrl' | 'price' | 'link' | 'notes' | 'mostWanted' | 'status'>,
  defaultCurrency: string
): ItemFormData {
  // Convert cents to dollars for display. A price of 0 is a real price ("0.00"),
  // not a missing one: an empty field would submit `price: null` and clear it.
  const priceInDollars = item.price?.value != null ? (item.price.value / 100).toFixed(2) : '';
  return {
    name: item.name,
    imageUrl: item.imageUrl || '',
    price: priceInDollars,
    // Display uppercase in UI
    currency: item.price?.currency?.toUpperCase() || defaultItemCurrency(defaultCurrency),
    link: item.link || '',
    notes: item.notes || '',
    mostWanted: item.mostWanted === true,
    isDraft: item.status === 'draft',
  };
}

/**
 * The price the form holds, in cents. An empty amount is no price, whatever
 * currency is picked, and so is one that isn't a number of zero or more (the
 * field's own `min` stops that in a browser).
 */
function formPrice(form: ItemFormData): ItemContent['price'] {
  if (!form.price) return null;
  const units = parseFloat(form.price);
  if (isNaN(units) || units < 0) return null;
  return {
    value: Math.round(units * 100),
    currency: (form.currency || 'USD').toLowerCase(),
  };
}

/** The item content the form holds, trimmed, the way an edit sends it. */
export function itemFormContent(form: ItemFormData): ItemContent {
  return {
    name: form.name.trim(),
    imageUrl: form.imageUrl.trim() || null,
    price: formPrice(form),
    link: form.link.trim() || null,
    notes: form.notes.trim() || null,
    mostWanted: form.mostWanted,
  };
}

function samePrice(a: ItemContent['price'], b: ItemContent['price']): boolean {
  if (!a || !b) return a === b;
  return a.value === b.value && a.currency === b.currency;
}

const PLAIN_FIELDS = ['name', 'imageUrl', 'link', 'notes', 'mostWanted'] as const;

function copyField<K extends keyof ItemContent>(to: ItemContentChanges, from: ItemContent, key: K) {
  to[key] = from[key];
}

/**
 * The content the form changed from `filledFrom`, the form as it was last
 * filled (from the item, or with what a save of it stored). Both are read the
 * way an edit sends them, so a field that would be sent as it already was (a
 * trailing space, `10` for `10.00`, another currency on no price) isn't a
 * change. The price is one field, its amount and currency together. An
 * unchanged field is left out, so the write doesn't touch it, and so is the
 * status (`isDraft`): editing an item never changes it. Empty (`{}`) when
 * nothing changed, which the API would refuse, so the caller sends nothing.
 */
export function itemChanges(form: ItemFormData, filledFrom: ItemFormData): ItemContentChanges {
  const next = itemFormContent(form);
  const saved = itemFormContent(filledFrom);
  const changes: ItemContentChanges = {};
  for (const field of PLAIN_FIELDS) {
    if (next[field] !== saved[field]) copyField(changes, next, field);
  }
  if (!samePrice(next.price, saved.price)) changes.price = next.price;
  return changes;
}
