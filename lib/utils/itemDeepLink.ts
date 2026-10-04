// A link to one item on its list (WIS-263), and the card it lands on.

/** The query parameter a link to one item on a list carries: `/wishlists/<id>?item=<itemId>`. */
export const ITEM_PARAM = 'item';

/** The DOM id of an item's card on its list, which `?item=` scrolls to. */
export function itemAnchorId(itemId: string): string {
  return `item-${itemId}`;
}

/** A list page's link to one of its items (the Reserved page's View on list). */
export function itemDeepLink(listIdOrSlug: string, itemId: string): string {
  return `/wishlists/${encodeURIComponent(listIdOrSlug)}?${ITEM_PARAM}=${encodeURIComponent(itemId)}`;
}
