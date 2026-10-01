/**
 * List-merge rules for the wishlist page's items, which have two writers: the
 * page's own mutations and the 5 s background poll that replaces the whole list
 * with the server's. A poll read that overlaps a mutation can land on either
 * side of it, so both writers need a guard.
 */

/**
 * The page's item mutations as the poll guard sees them: how many are in flight,
 * and when the latest one settled. It also sends the read that follows one the
 * guard found stale.
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
   * A stamp for a read of the list, to hand to `isStale` once the read lands.
   * Take it when the request is actually sent, not when a caller asks for the
   * list: concurrent reads share one request (see `useFetchItems`), and a
   * caller that joins one already in flight gets that request's list, so it
   * has to be judged by that request's stamp.
   */
  stamp(): number;
  /**
   * Whether a read's result is stale, because it would overwrite the fresher
   * local list (e.g. undo an optimistic edit, or hide an item that was just
   * added):
   * - a mutation is still in flight, so the read may predate its write (even a
   *   read sent after the mutation started), or
   * - the read was sent before the latest mutation settled.
   *
   * A read sent once every mutation has settled is kept, such as the reconcile
   * read the page sends as soon as a failed update settles.
   */
  isStale(readSentAt: number): boolean;
  /**
   * Set how `rereadWhenIdle` reads the list again: the page's polling sets it
   * while it runs and clears it (`null`) when it stops, so no re-read outlives
   * the polling. Either way, a re-read still waiting is dropped.
   */
  setReread(reread: (() => void) | null): void;
  /**
   * Read the list again once no mutation is in flight, to follow up a read that
   * turned out stale: straight away if none is, otherwise right after the last
   * one settles, never on a timer. Asking again while a re-read waits changes
   * nothing, so however many reads are dropped behind a slow or stalled
   * mutation, they end in a single re-read once it settles, and none before.
   * Does nothing while no re-read is set.
   *
   * The re-read goes out after the settle is stamped, so it's fresh, unless it
   * joins a read still in flight from before the settle (see `useFetchItems`):
   * that one is stale when it lands, and is followed by one more re-read.
   */
  rereadWhenIdle(): void;
}

// Every tracker's default clock: a sequence rather than the wall clock. Each
// stamp is later than every one before it, so a read sent right after a settle
// always counts as after it (no same-millisecond tie), a wall-clock change
// can't make every read look stale (which the re-read would turn into a stream
// of requests), and stamps from two trackers still compare (a remounted page
// can join a read its previous instance sent).
let lastStamp = 0;
function nextStamp(): number {
  lastStamp += 1;
  return lastStamp;
}

export function createMutationTracker(now: () => number = nextStamp): MutationTracker {
  let pending = 0;
  let lastSettledAt = 0;
  let reread: (() => void) | null = null;
  let rereadWaiting = false;
  return {
    async track<T>(mutation: () => Promise<T>): Promise<T> {
      pending += 1;
      try {
        return await mutation();
      } finally {
        lastSettledAt = now();
        pending -= 1;
        if (pending === 0 && rereadWaiting) {
          rereadWaiting = false;
          // Queued, so the re-read can't change this mutation's own outcome.
          queueMicrotask(() => reread?.());
        }
      }
    },
    stamp(): number {
      return now();
    },
    isStale(readSentAt: number): boolean {
      return pending > 0 || lastSettledAt > readSentAt;
    },
    setReread(next: (() => void) | null): void {
      reread = next;
      rereadWaiting = false;
    },
    rereadWhenIdle(): void {
      if (!reread) return;
      if (pending > 0) {
        rereadWaiting = true;
      } else {
        reread();
      }
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
