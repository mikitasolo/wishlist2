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
 * just added). A poll started in the same millisecond is kept: the page's
 * reconcile read after a failed update is issued right after the stamp.
 */
export function isStalePoll(pollStartedAt: number, lastMutationAt: number): boolean {
  return lastMutationAt > pollStartedAt;
}

/**
 * Put an item the server just created at the top of the list, unless a poll
 * already brought it in. A copy with the same `_id` can only come from a read
 * made after the write, so it is at least as fresh as the create response: it
 * stays as is rather than being listed twice.
 */
export function prependCreatedItem<T extends { _id: string }>(items: T[], created: T): T[] {
  if (items.some((item) => item._id === created._id)) return items;
  return [created, ...items];
}
