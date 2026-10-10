'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { ApiItem, ItemUpdate } from '@/types/api';
import { useFetchItems, type ReviewRequestOptions } from '@/lib/hooks/useItems';
import { POLL_INTERVAL_MS, useLiveRead, type LiveReadFailure } from '@/lib/hooks/useLiveRead';
import { isPublishedItem } from '@/lib/utils/itemCounts';
import { useUndoableAction } from '@/lib/hooks/useUndoableAction';
import type { PendingCommit } from '@/lib/utils/deferredCommit';
import {
  undoUpdate,
  updateItemOptimistically,
  type OptimisticItemUpdate,
} from '@/lib/utils/itemListMerge';
import { createMutationTracker } from '@/lib/utils/mutationTracker';
import { ReadRefusedError } from '@/lib/utils/resourceRead';

/** Before the first read: no items known (see `itemsLoaded`). */
const NO_ITEMS: ApiItem[] = [];

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
 * read, the 5 s poll while Items is on screen and the browser tab visible (and
 * a read on every return to it), through the shared `useLiveRead`, and the
 * optimistic updates that must survive it.
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

  // The page's item mutations. A background poll that lands while one is in
  // flight, or whose read was in flight across one, is stale and must be
  // discarded, otherwise it clobbers the optimistic state and the UI flickers;
  // the list is read again once they've settled. Every item mutation's request
  // goes through `mutations.track`, and is given up on after
  // ITEM_REQUEST_TIMEOUT_MS (`withRequestTimeout`), so a stalled one can't hold
  // off the polls for longer than that.
  const [mutations] = useState(createMutationTracker);

  // Failed items reads the page showed the skeleton for once the items had
  // been shown (the one after coming back to Items), and how many of them have
  // been answered (see the effect after `useLiveRead`).
  const [itemsReadFailures, setItemsReadFailures] = useState(0);
  const itemsReadFailuresSeen = useRef(0);

  const read = useCallback(
    async (stamp: () => number) => {
      if (!wishlistId) return null;
      // The number the request went out as (see the page's `readsSent`). It
      // stays 0 for a call that joins a read already on its way, whose own
      // caller answers for that read's refusal.
      let sentNo = 0;
      try {
        // A call that joins a read already in flight gets that read's
        // `sentAt`, not a later one.
        const answer = await fetchItemsHook(
          wishlistId,
          () => {
            sentNo = ++readsSent.current;
            return stamp();
          },
          readInit
        );
        return {
          // An owner's Preview as visitor: only what a visitor is shown.
          data: previewAsVisitor
            ? answer.items.filter((item) => isPublishedItem(item.status))
            : answer.items,
          sentAt: answer.sentAt,
        };
      } catch (error) {
        // The list was deleted, archived or made private, or the viewer taken
        // off it, since the page loaded (or it never was theirs to see): the
        // list read's own answer, so the same state, and no more polls.
        if (error instanceof ReadRefusedError) {
          if (sentNo) void onRefused(sentNo);
          return null;
        }
        throw error;
      }
    },
    [fetchItemsHook, wishlistId, onRefused, readInit, previewAsVisitor, readsSent]
  );

  const onError = useCallback((error: unknown, { silent, shown }: LiveReadFailure) => {
    console.error('Error fetching items:', error);
    // Until the items have been shown, the panel in their place says so (the
    // read's `failed`); after, a read the skeleton was shown for is toasted.
    if (!silent && shown) setItemsReadFailures((n) => n + 1);
  }, []);

  // The items: read when the list is loading or on screen and Items is the
  // tab, then every 5 s while the browser tab is visible and on every return
  // to it (`useLiveRead`). Until a read has landed (`itemsLoaded`) an empty
  // `items` doesn't mean the list has no items, so the page shows no counts or
  // controls for them: the skeleton while the first read is on its way, and if
  // it failed (`itemsFailed`) a panel saying so, with Try again. A read that
  // raced with a mutation is dropped if it was a background one, then the list
  // is read again once idle; a non-silent one (the first load, or the one
  // after coming back to Items) still lands, so the list isn't left empty.
  const {
    data: items,
    setData: setItems,
    loaded: itemsLoaded,
    failed: itemsFailed,
    loading: loadingItems,
    refresh: fetchItems,
  } = useLiveRead<ApiItem[]>({
    // Not while the list is unavailable (every read would be refused again)
    // or couldn't be read: Try again starts it over.
    enabled: polling && !!wishlistId && onItems,
    initialData: NO_ITEMS,
    read,
    pollMs: POLL_INTERVAL_MS,
    mutations,
    onError,
  });

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
    [mutations, fetchItems, setItems]
  );

  // Every item update (edit, book, publish, approve, ...) goes through here.
  // On success the server's item is merged into just this one: the PATCH
  // response carries a fresh priceInUsdCents, so a re-priced item sorts by its
  // new price straight away. On failure the request has toasted the error, the
  // change is undone at once, the list is reconciled with the server, and this
  // resolves null (see updateItemOptimistically).
  // An update as it shows before the server has answered.
  const showUpdate = useCallback(
    (item: ApiItem, updates: ItemUpdate): ApiItem => {
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
    [viewerId]
  );

  const handleUpdateItem = useCallback(
    (id: string, updates: ItemUpdate, options?: ReviewRequestOptions) =>
      updateOptimistically({
        id,
        apply: (item) => showUpdate(item, updates),
        request: () => {
          const { relatedItems: _shown, ...body } = updates;
          return updateItem(id, body, options);
        },
      }),
    [updateOptimistically, updateItem, showUpdate]
  );

  // Deferred item changes (WIS-387): shown at once with an Undo toast, sent
  // once the Undo window has passed. One per item at a time (`pendingFor`).
  const offerUndo = useUndoableAction();
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const pendingChanges = useRef(new Map<string, { pending: PendingCommit; kind: string }>());
  /** The item's deferred change still waiting, and what kind it is, if any. */
  const pendingFor = useCallback((id: string) => {
    const entry = pendingChanges.current.get(id);
    return entry?.pending.isPending() ? entry : undefined;
  }, []);
  /**
   * Before another change to an item is sent: its deferred change still
   * waiting goes first, and this resolves once that has settled, so the two
   * requests can't race.
   */
  const settlePending = useCallback(
    async (id: string) => {
      const entry = pendingFor(id);
      if (!entry) return;
      entry.pending.flush();
      await entry.pending.settled;
    },
    [pendingFor]
  );

  /**
   * Shows `apply`'s change to one item at once, with an Undo toast saying
   * `message`, and calls `commit` once the Undo window has passed (or the page
   * goes away, with `keepalive`). Undo, or a failed commit (resolving null, its
   * request having said why), puts back the fields the change made, unless
   * something has changed them since. The window and the commit are held as
   * one tracked mutation, so a poll can't undo the change while it waits.
   * Resolves with the item as shown, or null if it isn't on the list.
   */
  const deferItemChange = useCallback(
    ({
      id,
      kind,
      apply,
      message,
      commit,
    }: {
      id: string;
      /** What the change is (e.g. 'release'), for whoever acts on the item next. */
      kind: string;
      apply: (item: ApiItem) => ApiItem;
      /** The toast's line, or how to say it from the item as it was. */
      message: string | ((item: ApiItem) => string);
      commit: (keepalive: boolean) => Promise<ApiItem | null>;
    }): ApiItem | null => {
      const before = itemsRef.current.find((item) => item._id === id);
      if (!before) return null;
      // One deferred change per item: one still waiting is sent now, ahead of
      // this one's window.
      pendingFor(id)?.pending.flush();
      const optimistic = apply(before);
      setItems((prev) => prev.map((item) => (item._id === id ? apply(item) : item)));
      const revert = () =>
        setItems((prev) =>
          prev.map((item) => (item._id === id ? undoUpdate(item, before, optimistic) : item))
        );
      const pending = offerUndo({
        message: typeof message === 'function' ? message(before) : message,
        onUndo: revert,
        commit: async ({ keepalive }) => {
          const updated = await commit(keepalive);
          if (!updated) revert();
        },
      });
      pendingChanges.current.set(id, { pending, kind });
      void mutations
        .track(() => pending.settled)
        .then(() => {
          if (pendingChanges.current.get(id)?.pending === pending) {
            pendingChanges.current.delete(id);
          }
        });
      return optimistic;
    },
    [offerUndo, mutations, pendingFor, setItems]
  );

  return {
    items,
    setItems,
    deferItemChange,
    pendingFor,
    settlePending,
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

export type WishlistItemsControl = ReturnType<typeof useWishlistItems>;
