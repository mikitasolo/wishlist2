/**
 * List-merge rules for the wishlist page's items, which have two writers: the
 * page's own mutations and the 5 s background poll that replaces the whole list
 * with the server's. A poll read that overlaps a mutation can land on either
 * side of it, so both writers need a guard.
 */

/**
 * Whether a background poll's result is stale and must be dropped: its read
 * started before the latest local mutation settled, so it may predate that
 * write and would overwrite the fresher local list (e.g. hide an item that was
 * just added).
 */
export function isStalePoll(pollStartedAt: number, lastMutationAt: number): boolean {
  return lastMutationAt > pollStartedAt;
}

/**
 * Put an item the server just created at the top of the list. A poll that read
 * after the write may already have brought it in, so a copy with the same `_id`
 * is replaced in place instead of listed twice. The server response's fields
 * win; fields only the list read carries (like `priceInUsdCents`) are kept.
 */
export function prependItem<T extends { _id: string }>(items: T[], created: T): T[] {
  if (!items.some((item) => item._id === created._id)) return [created, ...items];
  return items.map((item) => (item._id === created._id ? { ...item, ...created } : item));
}
