'use client';

import { useCallback, useMemo, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { useGroupGiftRequest } from '@/lib/hooks/useGroupGiftRequest';
import { useItemDeepLink } from '@/lib/hooks/useItemDeepLink';
import type { ListFilters } from '@/lib/hooks/useListFilters';
import type { WishlistItemActions } from '@/lib/hooks/useWishlistItemActions';
import type { WishlistItemsControl } from '@/lib/hooks/useWishlistItems';
import {
  applyGroupGiftAction,
  withServerGroupGift,
  type GroupGiftAction,
} from '@/lib/utils/groupGiftClient';
import { GROUP_GIFT_TOASTS, leaveGroupGiftToast } from '@/lib/utils/groupGiftCopy';
import type { ItemRef } from '@/lib/utils/itemLinks';
import type { ViewerRole } from '@/lib/utils/itemStatus';
import { orderListItems } from '@/lib/utils/listChips';
import { createSubmissionKeys } from '@/lib/utils/submissionKey';
import type { ApiItem } from '@/types/api';

export interface ItemCardsOptions {
  wishlistId: string | null;
  viewerRole: ViewerRole;
  viewerId: string | null;
  /** Items is the tab on screen. */
  onItems: boolean;
  itemsLoaded: boolean;
  filters: Pick<ListFilters, 'viewItems' | 'sortedItems' | 'sortBy' | 'pinItem' | 'showAllItems'>;
  updateOptimistically: WishlistItemsControl['updateOptimistically'];
  deferItemChange: WishlistItemsControl['deferItemChange'];
  settlePending: WishlistItemsControl['settlePending'];
  /** A card's status change, with its toasts (`useReserveToast`, `useReceivedToast`). */
  handleCardUpdate: WishlistItemActions['handleCardUpdate'];
}

/**
 * What the wishlist page's item cards do beyond the dialogs (WIS-372): a
 * changed card staying put, a member's group gift actions, the `?item=` deep
 * link and "Goes with" chips. Kept by the page, not the Items tab, so they
 * outlive a switch of tab.
 */
export function useItemCards({
  wishlistId,
  viewerRole,
  viewerId,
  onItems,
  itemsLoaded,
  filters,
  updateOptimistically,
  deferItemChange,
  settlePending,
  handleCardUpdate,
}: ItemCardsOptions) {
  const { showToast } = useToast();
  const { viewItems, sortedItems, sortBy, pinItem, showAllItems } = filters;

  // A member's group gift actions (WIS-362): shown at once, merged from the
  // server's answer, undone on a failure like any item update. A retry of a
  // start or ending whose answer was lost sends the same Idempotency-Key.
  const requestGroupGift = useGroupGiftRequest(
    useCallback((message: string) => showToast(message, 'error'), [showToast])
  );
  // One key set per item, so another item's success doesn't drop the key a retry needs.
  const [groupGiftKeys] = useState(
    () => new Map<string, ReturnType<typeof createSubmissionKeys>>()
  );
  const handleGroupGift = useCallback(
    async (id: string, action: GroupGiftAction) => {
      if (!viewerId) return null;
      pinItem(id);
      // A deferred change to this item still waiting (a Release, a leave) is
      // sent first, and settled, so this request can't race it.
      await settlePending(id);
      const keys = groupGiftKeys.get(id) ?? createSubmissionKeys();
      groupGiftKeys.set(id, keys);
      const key = keys.keyFor(action);
      // Leaving or cancelling a group gift (WIS-387) shows at once with Undo,
      // and is sent once the Undo window has passed: undone, nobody was told
      // (a cancel tells every contributor, a leave may hand the gift on) and
      // no reservation was ended. The commit adds no second optimistic change.
      if (action.type === 'leave' || action.type === 'cancel') {
        return deferItemChange({
          id,
          kind: `group-gift-${action.type}`,
          message:
            action.type === 'leave'
              ? (item) => leaveGroupGiftToast(item.groupGift)
              : GROUP_GIFT_TOASTS.cancel,
          apply: (item) => applyGroupGiftAction(item, action, viewerId),
          commit: async (keepalive) => {
            const updated = await updateOptimistically({
              id,
              apply: (item) => item,
              request: async () => {
                const answer = await requestGroupGift(id, action, key, keepalive);
                return answer && withServerGroupGift(answer);
              },
            });
            if (updated) groupGiftKeys.delete(id);
            return updated;
          },
        });
      }
      const updated = await updateOptimistically({
        id,
        apply: (item) => applyGroupGiftAction(item, action, viewerId),
        request: async () => {
          const answer = await requestGroupGift(id, action, key);
          return answer && withServerGroupGift(answer);
        },
      });
      if (updated) {
        groupGiftKeys.delete(id);
        showToast(GROUP_GIFT_TOASTS[action.type], 'success');
      }
      return updated;
    },
    [
      viewerId,
      pinItem,
      groupGiftKeys,
      requestGroupGift,
      updateOptimistically,
      deferItemChange,
      settlePending,
      showToast,
    ]
  );

  const handleStickyCardUpdate = useCallback(
    (id: string, updates: Partial<ApiItem>) => {
      if (updates.status !== undefined) pinItem(id);
      return handleCardUpdate(id, updates);
    },
    [pinItem, handleCardUpdate]
  );

  // `?item=<id>` (the Reserved page's View on list): scroll to that item and
  // highlight it, clearing a chip or search that would hide it.
  // What All shows this viewer, so a link to anything else (a draft sent to
  // a member, say) does nothing rather than resetting their view.
  const itemIds = useMemo(
    () => orderListItems(viewItems, 'all', viewerRole, viewerId, sortBy).map((i) => i._id),
    [viewItems, viewerRole, viewerId, sortBy]
  );
  const isItemShown = useCallback(
    (id: string) => sortedItems.some((i) => i._id === id),
    [sortedItems]
  );
  // A "Goes with" chip (WIS-29) goes to its item the same way (`showItem`).
  const { highlightedId: highlightedItemId, showItem } = useItemDeepLink({
    listKey: wishlistId,
    ready: itemsLoaded && onItems,
    itemIds,
    isShown: isItemShown,
    reveal: showAllItems,
  });

  // Each card's "Goes with" chips (WIS-29): the partners the server gave, less
  // any not among the items shown to this viewer (an owner's Preview as
  // visitor drops drafts; an item deleted here is gone before the next read).
  const relatedById = useMemo(() => {
    const shown = new Set(viewItems.map((item) => item._id));
    const byId = new Map<string, ItemRef[]>();
    for (const item of viewItems) {
      const refs = (item.relatedItems ?? []).filter((ref) => shown.has(ref.id));
      if (refs.length) byId.set(item._id, refs);
    }
    return byId;
  }, [viewItems]);

  return {
    handleGroupGift,
    handleStickyCardUpdate,
    highlightedItemId,
    showItem,
    relatedById,
  };
}

export type ItemCards = ReturnType<typeof useItemCards>;
