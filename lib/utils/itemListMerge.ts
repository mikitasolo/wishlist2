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
 * The page's item mutations as the poll guard sees them: how many are in flight,
 * and when the latest one settled.
 */
export interface MutationTracker {
  /**
   * Run one item mutation's request, counted as in flight until it settles,
   * whether it resolves or rejects (the count can't leak). Apply its optimistic
   * change right before, with no `await` in between, and merge its result or
   * issue a reconcile read once this has resolved: the settle is stamped by
   * then, so a read issued afterwards isn't mistaken for a stale one.
   */
  track<T>(mutation: () => Promise<T>): Promise<T>;
  /**
   * Whether a poll whose read started at `pollStartedAt` must be dropped: a
   * mutation is still in flight, so the read may predate its write (even one
   * that started after the mutation did), or it read across one that has since
   * settled (see `isStalePoll`).
   */
  isStale(pollStartedAt: number): boolean;
}

export function createMutationTracker(now: () => number = Date.now): MutationTracker {
  let pending = 0;
  let lastSettledAt = 0;
  return {
    async track<T>(mutation: () => Promise<T>): Promise<T> {
      pending += 1;
      try {
        return await mutation();
      } finally {
        lastSettledAt = now();
        pending -= 1;
      }
    },
    isStale(pollStartedAt: number): boolean {
      return pending > 0 || isStalePoll(pollStartedAt, lastSettledAt);
    },
  };
}

/**
 * Put an item the server just created at the top of the list, unless a read
 * already brought it in. A copy with the same `_id` can only come from a read
 * made after the write, so it is at least as fresh as the create response: it
 * stays as is rather than being listed twice.
 */
export function prependCreatedItem<T extends { _id: string }>(items: T[], created: T): T[] {
  if (items.some((item) => item._id === created._id)) return items;
  return [created, ...items];
}
