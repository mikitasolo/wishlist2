'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { ApiItem, ItemUpdate } from '@/types/api';
import { useFetchItems, type ReviewRequestOptions } from '@/lib/hooks/useItems';
import { isPublishedItem } from '@/lib/utils/itemCounts';
import { updateItemOptimistically, type OptimisticItemUpdate } from '@/lib/utils/itemListMerge';
import { createMutationTracker } from '@/lib/utils/mutationTracker';
import { ReadRefusedError } from '@/lib/utils/resourceRead';

/** An optimistic item update, less what the page's items always supply. */
export type ItemOptimisticUpdate = Omit<
  OptimisticItemUpdate<ApiItem>,
  'setItems' | 'mutations' | 'reconcile'
>;

/** Where a wishlist page stands with its list (see the page's `pageLoad`). */
export type PageLoad = 'loading' | 'ready' | 'unavailable' | 'failed';

/**
 * The callbacks are expected to be stable (memoized): a new one re-creates
 * `fetchItems`, which restarts the poll.
 */
export interface WishlistItemsOptions {
  /** The list's id or slug, as the page's URL names it (null: no list). */
  wishlistId: string | null;
  /** What every read sends: a share link's `X-Share-Token`, in link mode. */
  readInit: RequestInit | undefined;
  /** An owner's Preview as visitor: only what a visitor is shown. */
  previewAsVisitor: boolean;
  /** Whether the list is loading or on screen: only then are the items read. */
  polling: boolean;
  /** Whether the list's toast-worthy state is known: `'loading'` holds a failure toast back. */
  pageLoad: PageLoad;
  /** Whether the Items tab is on screen: the items are polled only while it is. */
  onItems: boolean;
  /**
   * The page's count of reads of the list and its items (shared with the list
   * read), so whichever read was sent later decides on a refusal.
   */
  readsSent: MutableRefObject<number>;
  /** A read numbered `sentNo` was refused (the list is gone or hidden). */
  onRefused: (sentNo: number) => void | Promise<void>;
  /** The toast for a failed read once the items have been shown. */
  onReadFailed: () => void;
  /** The signed-in viewer, whose reservation an optimistic reserve shows. */
  viewerId: string | null;
  /** The item update request (`useUpdateItem`'s), which reports its own failure. */
  updateItem: (
    id: string,
    updates: ItemUpdate,
    options?: ReviewRequestOptions
  ) => Promise<ApiItem | null>;
}

/**
 * A wishlist page's items (screens.md, "Data loading & mutations"): the first
 * read, the 5 s poll while Items is on screen (and on coming back to the tab),
 * and the optimistic updates that must survive it.
 *
 * Every item mutation goes through `mutations.track`: a poll that lands while
 * one is in flight, or whose read was in flight across one, is stale and is
 * dropped, then the list is read again once they've settled. Until a read has
 * landed (`itemsLoaded`) an empty `items` doesn't mean an empty list; a failed
 * first read sets `itemsFailed` (the page's LoadError), and a later failed
 * read keeps what's shown.
 */
export function useWishlistItems({
  wishlistId,
  readInit,
  previewAsVisitor,
  polling,
  pageLoad,
  onItems,
  readsSent,
  onRefused,
  onReadFailed,
  viewerId,
  updateItem,
}: WishlistItemsOptions) {
  const fetchItemsHook = useFetchItems();
  const [items, setItems] = useState<ApiItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);

  // The page's item mutations. A background poll that lands while one is in
  // flight, or whose read was in flight across one, is stale and must be
  // discarded, otherwise it clobbers the optimistic state and the UI flickers;
  // the list is read again once they've settled. Every item mutation's request
  // goes through `mutations.track`, and is given up on after
  // ITEM_REQUEST_TIMEOUT_MS (`withRequestTimeout`), so a stalled one can't hold
  // off the polls for longer than that.
  const [mutations] = useState(createMutationTracker);

  // Whether a read of the items has landed yet (`itemsShown` too, for
  // `fetchItems` to read). Until one has, an empty `items` doesn't mean the
  // list has no items, so the page shows no counts or controls for them: the
  // skeleton while the first read is on its way, and if it failed
  // (`itemsFailed`) a panel saying so, with Try again. A poll that lands
  // meanwhile fills the list in.
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const itemsShown = useRef(false);
  const [itemsFailed, setItemsFailed] = useState(false);
  // Failed items reads the page showed the skeleton for once the items had
  // been shown (the one after coming back to Items), and how many of them have been
  // answered (see the effect after `fetchItems`).
  const [itemsReadFailures, setItemsReadFailures] = useState(0);
  const itemsReadFailuresSeen = useRef(0);

  const fetchItems = useCallback(
    async (silent = false) => {
      if (!wishlistId) return;

      if (!silent) {
        setLoadingItems(true);
        // The skeleton again, not the panel, while this read is on its way.
        setItemsFailed(false);
      }

      // The number the request went out as (see the page's `readsSent`). It
      // stays 0 for a call that joins a read already on its way, whose own
      // caller answers for that read's refusal.
      let sentNo = 0;
      try {
        // Rejects when the read fails, so a failed poll or reconcile keeps the
        // list on screen: only a successful read replaces it. A call that joins
        // a read already in flight gets that read's `sentAt`, not a later one.
        const read = await fetchItemsHook(
          wishlistId,
          () => {
            sentNo = ++readsSent.current;
            return mutations.stamp();
          },
          readInit
        );
        // A read that raced with a mutation (landed while one was in flight, or
        // was sent before one settled) may predate fresher local state, so the
        // list is read again once no mutation is in flight. A background read's
        // result is dropped; a non-silent one (the first load, or the one after
        // coming back to Items) still lands, so the list isn't left empty.
        if (mutations.isStale(read.sentAt)) {
          mutations.rereadWhenIdle();
          if (silent) return;
        }
        // An owner's Preview as visitor: only what a visitor is shown.
        setItems(
          previewAsVisitor ? read.items.filter((item) => isPublishedItem(item.status)) : read.items
        );
        setItemsLoaded(true);
        setItemsFailed(false);
        itemsShown.current = true;
      } catch (error) {
        // The list was deleted, archived or made private, or the viewer taken
        // off it, since the page loaded (or it never was theirs to see): the
        // list read's own answer, so the same state, and no more polls.
        if (error instanceof ReadRefusedError) {
          if (sentNo) void onRefused(sentNo);
          return;
        }
        console.error('Error fetching items:', error);
        if (!silent) {
          // Until the items have been shown, the panel in their place says so.
          if (itemsShown.current) setItemsReadFailures((n) => n + 1);
          else setItemsFailed(true);
        }
      } finally {
        if (!silent) {
          setLoadingItems(false);
        }
      }
    },
    [fetchItemsHook, wishlistId, mutations, onRefused, readInit, previewAsVisitor, readsSent]
  );

  // Try again, after the first items read failed: the skeleton, then a fresh read.
  const retryItems = useCallback(() => {
    void fetchItems();
  }, [fetchItems]);

  // A failed items read the page showed the skeleton for, once the items had
  // been shown, is toasted, but only about a list on screen. It waits for the
  // list read to have landed: a list that turns out unavailable, or couldn't be
  // read, says so itself.
  useEffect(() => {
    if (pageLoad === 'loading' || itemsReadFailures === itemsReadFailuresSeen.current) return;
    itemsReadFailuresSeen.current = itemsReadFailures;
    if (pageLoad === 'ready') onReadFailed();
  }, [pageLoad, itemsReadFailures, onReadFailed]);

  useEffect(() => {
    // Not while the list is unavailable (every read would be refused again) or
    // couldn't be read: Try again starts it over.
    if (!polling) return;
    if (wishlistId && onItems) {
      // Reset loading state when switching to items tab
      setLoadingItems(true);
      // While this tab polls, a read that turns out stale is followed by a
      // background one (see fetchItems).
      mutations.setReread(() => fetchItems(true));
      fetchItems();

      // Poll for updates every 5 seconds when tab is active
      const pollInterval = setInterval(() => {
        if (document.visibilityState === 'visible') {
          fetchItems(true);
        }
      }, 5000);

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          fetchItems(true);
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearInterval(pollInterval);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        // Coming back to the items tab reads the list anyway, and a read still
        // in flight from here mustn't send another.
        mutations.setReread(null);
      };
    } else if (!onItems) {
      // Reset loading state when switching away from items tab
      setLoadingItems(false);
    }
  }, [wishlistId, onItems, fetchItems, mutations, polling]);

  // An optimistic update of one item (see updateItemOptimistically): shown at
  // once, merged from the server's answer, undone on a failure and then
  // reconciled with a background read.
  const updateOptimistically = useCallback(
    (update: ItemOptimisticUpdate) =>
      updateItemOptimistically({
        ...update,
        setItems,
        mutations,
        reconcile: () => fetchItems(true),
      }),
    [mutations, fetchItems]
  );

  // Every item update (edit, book, publish, approve, ...) goes through here.
  // On success the server's item is merged into just this one: the PATCH
  // response carries a fresh priceInUsdCents, so a re-priced item sorts by its
  // new price straight away. On failure the request has toasted the error, the
  // change is undone at once, the list is reconciled with the server, and this
  // resolves null (see updateItemOptimistically).
  const handleUpdateItem = useCallback(
    (id: string, updates: ItemUpdate, options?: ReviewRequestOptions) =>
      updateOptimistically({
        id,
        apply: (item) => {
          // Links are sent as what changed, and shown as the `relatedItems`
          // the caller worked out (WIS-29); never sent as shown.
          const { linkItems: _link, unlinkItems: _unlink, ...shown } = updates;
          const optimistic = { ...item, ...shown };
          if (updates.status === 'booked' && viewerId) {
            optimistic.bookedBy = viewerId;
          } else if (
            (updates.status === 'available' ||
              updates.status === 'draft' ||
              updates.status === 'completed') &&
            item.status === 'booked'
          ) {
            optimistic.bookedBy = null;
          }
          return optimistic;
        },
        request: () => {
          const { relatedItems: _shown, ...body } = updates;
          return updateItem(id, body, options);
        },
      }),
    [updateOptimistically, updateItem, viewerId]
  );

  return {
    items,
    setItems,
    itemsLoaded,
    itemsFailed,
    loadingItems,
    mutations,
    fetchItems,
    retryItems,
    updateOptimistically,
    handleUpdateItem,
  };
}
