/**
 * List-merge rules for the wishlist page's items, which have two writers: the
 * page's own mutations and the 5 s background poll that replaces the whole list
 * with the server's. A poll read that overlaps a mutation can land on either
 * side of it, so both writers need a guard (`createMutationTracker`, in
 * `lib/utils/mutationTracker.ts`).
 */

import type { MutationTracker } from '@/lib/utils/mutationTracker';

export interface OptimisticItemUpdate<T extends { _id: string }> {
  /** The item to update. */
  id: string;
  /** The item as it should show while the request is in flight. */
  apply: (item: T) => T;
  /**
   * The request: resolves with the server's item, or `null` once it has
   * reported the failure. A rejection counts as a failure too, and is passed on.
   */
  request: () => Promise<T | null>;
  /** The list's state setter, given updaters only. */
  setItems: (update: (items: T[]) => T[]) => void;
  mutations: Pick<MutationTracker, 'track'>;
  /** Read the list from the server, after a failure. */
  reconcile: () => void;
}

/**
 * `current` with the fields an update changed (from `before` to `optimistic`)
 * put back as they were, where they still show the update's value. A field
 * something else has changed since (another update to the same item, the
 * server's copy from a read) is kept. Fields are compared by value, so this
 * holds even if the updater that made `optimistic` ran more than once.
 */
export function undoUpdate<T extends object>(current: T, before: T, optimistic: T): T {
  const keys = new Set([...Object.keys(before), ...Object.keys(optimistic)]) as Set<keyof T>;
  let undone = current;
  for (const key of keys) {
    if (Object.is(optimistic[key], before[key]) || !Object.is(current[key], optimistic[key])) {
      continue;
    }
    if (undone === current) undone = { ...current };
    undone[key] = before[key];
  }
  return undone;
}

/**
 * One optimistic update of one item, the wishlist page's single path for it:
 * show the change at once, send the request through `mutations.track`, then
 * merge the server's item into just that item. If the request fails, the change
 * is undone straight away (the item put back as it was, keeping anything else
 * that changed it meanwhile), and only then is the list reconciled with the
 * server, in case the write landed after all. The undo can't be left to the
 * reconcile read: that read is dropped while another mutation is in flight, and
 * a failed one keeps the list, so the failed change (a booking, say) would stay
 * on screen until a later read got through.
 *
 * Resolves with the server's item, or `null` if the update failed.
 */
export async function updateItemOptimistically<T extends { _id: string }>({
  id,
  apply,
  request,
  setItems,
  mutations,
  reconcile,
}: OptimisticItemUpdate<T>): Promise<T | null> {
  // Taken where the change is applied, so the undo starts from exactly the item
  // it replaced. A state's updaters run in the order they were queued, each on
  // the result of the ones before (React re-running one re-takes them from the
  // same point), so these are set by the time the undo's updater runs.
  let before: T | undefined;
  let optimistic: T | undefined;
  setItems((items) =>
    items.map((item) => {
      if (item._id !== id) return item;
      before = item;
      optimistic = apply(item);
      return optimistic;
    })
  );

  let updated: T | null = null;
  try {
    // No `await` between the change and the request, and nothing is merged or
    // read until it has settled (see `track`).
    updated = await mutations.track(request);
  } finally {
    if (updated) {
      const merged = updated;
      setItems((items) => items.map((item) => (item._id === id ? { ...item, ...merged } : item)));
    } else {
      setItems((items) =>
        items.map((item) =>
          item._id === id && before && optimistic ? undoUpdate(item, before, optimistic) : item
        )
      );
      reconcile();
    }
  }
  return updated;
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
