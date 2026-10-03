/**
 * Pin to top: an owner pins one of their own lists to the top of their own
 * list screens (the dashboard's Your wishlists, Your wishlists' page). The pin
 * is per-owner (`Wishlist.featuredBy`), so on a co-owned list one owner's pin
 * never moves it for the others, and the API folds it to the caller's own
 * boolean `featured` (`serializeWishlist`). `PATCH /api/wishlists/[id]` with
 * `{ featured }` sets it, and keeps at most one pinned per owner: pinning a list
 * unpins the caller's other one.
 */

/** A list as the pin reads it: the caller's own pin, folded to a boolean. */
interface Pinnable {
  _id: { toString(): string };
  featured?: boolean;
}

/**
 * `lists` with the pinned ones first. Everything else keeps the order it came
 * in (the nearest occasion first, `sortByUpcomingOccasion`), and so do the
 * pinned ones among themselves. Returns a new array; `lists` is untouched.
 */
export function pinnedFirst<T extends Pinnable>(lists: readonly T[]): T[] {
  return [...lists.filter((w) => w.featured), ...lists.filter((w) => !w.featured)];
}

/**
 * The caller's lists once a pin (or unpin) of `pinnedId` has landed: pinning it
 * unpins every other, as the server does, and unpinning it leaves the rest.
 */
export function withPin<T extends Pinnable>(
  lists: readonly T[],
  pinnedId: string,
  pin: boolean
): T[] {
  return lists.map((w) => {
    const isTarget = w._id.toString() === pinnedId;
    const featured = isTarget ? pin : pin ? false : !!w.featured;
    return featured === !!w.featured ? w : { ...w, featured };
  });
}
