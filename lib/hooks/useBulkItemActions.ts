'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { useBusyIds } from '@/lib/hooks/useBusyIds';
import { useUndoableAction } from '@/lib/hooks/useUndoableAction';
import type { WishlistItemsControl } from '@/lib/hooks/useWishlistItems';
import {
  applyBulkAction,
  bulkDoneMessage,
  bulkFailedMessage,
  bulkTargets,
  BULK_ITEM_ACTIONS,
  BULK_ITEMS_MAX,
  isSelectableItem,
  type BulkItemAction,
  type BulkItemResult,
} from '@/lib/utils/bulkItems';
import { restoreRemoved } from '@/lib/utils/deferredCommit';
import { undoUpdate } from '@/lib/utils/itemListMerge';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';
import { createSubmissionKeys, IDEMPOTENCY_HEADER } from '@/lib/utils/submissionKey';
import type { ApiItem, ApiResponse } from '@/types/api';

type BulkAnswer = BulkItemResult<ApiItem>;

const FAILED = 'Failed to update items';

/**
 * Send one bulk action: resolves with the server's answer, or rejects with
 * the error to show. Bounded by `withRequestTimeout`; `keepalive` when the
 * page is going away (a deferred delete sent from `pagehide`).
 */
export async function sendBulkItemAction(
  wishlistId: string,
  action: BulkItemAction,
  itemIds: string[],
  key: string,
  keepalive = false
): Promise<BulkAnswer> {
  return withRequestTimeout(async (signal) => {
    const response = await fetch(`/api/wishlists/${wishlistId}/items/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key },
      body: JSON.stringify({ action, itemIds }),
      signal,
      keepalive,
    });
    const result: ApiResponse<BulkAnswer> = await response.json();
    if (!result.success || !result.data) throw new Error(result.error || FAILED);
    return result.data;
  });
}

export interface BulkItemActionsOptions {
  /** What the page's writes address the list by (see `useWishlistLoad`). */
  apiId: () => string;
  /** Whether Select mode is on offer: an owner's own view of the list. */
  enabled: boolean;
  /** The items on screen (the filters' result): only those picked there are acted on. */
  shown: readonly ApiItem[];
  itemsControl: Pick<
    WishlistItemsControl,
    'items' | 'setItems' | 'mutations' | 'fetchItems' | 'settlePending'
  >;
}

/**
 * An owner's Select mode on their list (WIS-386): which items are picked, and
 * the action bar's actions, each one request for the whole batch
 * (`POST /api/wishlists/[id]/items/bulk`) with one `Idempotency-Key`.
 *
 * Status changes and Most wanted are optimistic: every item they apply to
 * shows the change at once, each is busy (`useBusyIds`) until the request
 * settles, the server's items are merged in, and only the items it couldn't
 * change are put back (each on its own, keeping anything that changed it
 * since). A delete takes the items off at once and offers Undo, sending the
 * request only once the Undo window has passed (`useUndoableAction`, as a
 * single delete does), so an undone one released no reservation and freed no
 * image. Either way the request is held as a tracked mutation, so a poll
 * can't undo it meanwhile, and a failure says how many, never why: an owner
 * never learns an item was reserved.
 */
export function useBulkItemActions({
  apiId,
  enabled,
  shown,
  itemsControl,
}: BulkItemActionsOptions) {
  const { items, setItems, mutations, fetchItems, settlePending } = itemsControl;
  const { showToast } = useToast();
  const offerUndo = useUndoableAction();
  const { busy, run, running } = useBusyIds();
  // One key per batch, the same on a retry of the same action on the same
  // items (a timeout whose request may have landed), new after a success.
  const [keys] = useState(createSubmissionKeys);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  // Not an owner's view any more (a role change, Preview as visitor): Select
  // mode goes, with what was picked.
  useEffect(() => {
    if (enabled) return;
    setSelecting(false);
    setSelected(new Set());
  }, [enabled]);

  // The picked items on screen, in their order: one deleted, hidden by a
  // filter or turned into something unpickable since simply drops out.
  const selectedItems = useMemo(
    () => shown.filter((item) => selected.has(item._id) && isSelectableItem(item)),
    [shown, selected]
  );

  /** How many picked items each action would change (0 disables it). */
  const counts = useMemo(() => {
    const out = {} as Record<BulkItemAction, number>;
    for (const action of BULK_ITEM_ACTIONS) out[action] = bulkTargets(action, selectedItems).length;
    return out;
  }, [selectedItems]);

  const start = useCallback(() => setSelecting(true), []);
  const stop = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  /** Pick every one of `shown` that can be picked (the items on screen). */
  const selectAll = useCallback((shown: readonly ApiItem[]) => {
    setSelected(new Set(shown.filter(isSelectableItem).map((item) => item._id)));
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);

  // The items as last rendered, so an action reads the latest without being
  // re-created on every poll.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const applyUpdate = useCallback(
    (action: Exclude<BulkItemAction, 'delete'>, targets: ApiItem[]) => {
      const ids = targets.map((item) => item._id);
      const idSet = new Set(ids);
      const key = keys.keyFor({ action, ids });
      const before = new Map<string, ApiItem>();
      const optimistic = new Map<string, ApiItem>();
      setItems((prev) =>
        prev.map((item) => {
          if (!idSet.has(item._id)) return item;
          const shown = applyBulkAction(action, item);
          before.set(item._id, item);
          optimistic.set(item._id, shown);
          return shown;
        })
      );
      const putBack = (back: ReadonlySet<string>) =>
        setItems((prev) =>
          prev.map((item) => {
            const was = before.get(item._id);
            const shown = optimistic.get(item._id);
            return back.has(item._id) && was && shown ? undoUpdate(item, was, shown) : item;
          })
        );

      const request = mutations.track(async () => {
        await Promise.all(ids.map((id) => settlePending(id)));
        return sendBulkItemAction(apiId(), action, ids, key);
      });
      // Each card is busy until the batch settles.
      for (const id of ids) void run(id, () => request.catch(() => undefined));

      void request.then(
        (answer) => {
          keys.reset();
          const fresh = new Map(answer.items.map((item) => [item._id, item]));
          const gone = new Set(answer.gone);
          const failed = new Set(answer.failed);
          setItems((prev) =>
            prev
              .filter((item) => !gone.has(item._id))
              .map((item) => {
                const server = fresh.get(item._id);
                return server ? { ...item, ...server } : item;
              })
          );
          if (failed.size) putBack(failed);
          if (answer.done.length) showToast(bulkDoneMessage(action, answer.done.length), 'success');
          if (failed.size) {
            showToast(bulkFailedMessage(failed.size), 'error');
            void fetchItems(true);
          }
        },
        (error: unknown) => {
          putBack(idSet);
          showToast(error instanceof Error ? error.message : FAILED, 'error');
          void fetchItems(true);
        }
      );
    },
    [keys, setItems, mutations, settlePending, apiId, run, showToast, fetchItems]
  );

  const deferDelete = useCallback(
    (targets: ApiItem[]) => {
      const ids = targets.map((item) => item._id);
      const idSet = new Set(ids);
      const key = keys.keyFor({ action: 'delete', ids });
      // Where each was, to put it back there on Undo or a failure.
      const index = new Map<string, number>();
      itemsRef.current.forEach((item, i) => {
        if (idSet.has(item._id)) index.set(item._id, i);
      });
      setItems((prev) => prev.filter((item) => !idSet.has(item._id)));
      const putBack = (back: ApiItem[]) =>
        setItems((prev) =>
          [...back]
            .sort((a, b) => (index.get(a._id) ?? 0) - (index.get(b._id) ?? 0))
            .reduce((list, item) => restoreRemoved(list, item, index.get(item._id) ?? 0), prev)
        );

      const pending = offerUndo({
        message: bulkDoneMessage('delete', ids.length),
        onUndo: () => putBack(targets),
        commit: async ({ keepalive }) => {
          try {
            const answer = await sendBulkItemAction(apiId(), 'delete', ids, key, keepalive);
            keys.reset();
            // Left as they were: back on the list, as the server has them.
            const fresh = new Map(answer.items.map((item) => [item._id, item]));
            const kept = new Set([...answer.failed, ...answer.skipped]);
            const back = targets
              .filter((item) => kept.has(item._id))
              .map((item) => ({ ...item, ...fresh.get(item._id) }));
            if (back.length) {
              putBack(back);
              showToast(bulkFailedMessage(back.length), 'error');
            }
          } catch (error) {
            putBack(targets);
            showToast(error instanceof Error ? error.message : FAILED, 'error');
          }
        },
      });
      void mutations.track(() => pending.settled);
    },
    [keys, setItems, offerUndo, apiId, showToast, mutations]
  );

  /**
   * Apply `action` to every picked item it changes (the first
   * `BULK_ITEMS_MAX`), less any still busy with an earlier batch. Picks are
   * cleared; Select mode stays on.
   */
  const act = useCallback(
    (action: BulkItemAction) => {
      const targets = bulkTargets(action, selectedItems)
        .filter((item) => !running(item._id))
        .slice(0, BULK_ITEMS_MAX);
      if (!targets.length) return;
      setSelected(new Set());
      if (action === 'delete') deferDelete(targets);
      else applyUpdate(action, targets);
    },
    [selectedItems, running, deferDelete, applyUpdate]
  );

  return {
    selecting,
    start,
    stop,
    selected,
    selectedCount: selectedItems.length,
    counts,
    toggle,
    selectAll,
    clear,
    act,
    busy,
  };
}

export type BulkItemActionsControl = ReturnType<typeof useBulkItemActions>;
