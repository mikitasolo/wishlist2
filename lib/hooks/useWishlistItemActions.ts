'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import type { LinkOption } from '@/components/ItemLinkPicker';
import { useToast } from '@/components/ToastProvider';
import { useCreateItem, useDeleteItem } from '@/lib/hooks/useItems';
import { useReceivedToast } from '@/lib/hooks/useReceivedToast';
import { useReserveToast } from '@/lib/hooks/useReserveToast';
import type { WishlistItemsControl } from '@/lib/hooks/useWishlistItems';
import { prependCreatedItem } from '@/lib/utils/itemListMerge';
import { applyLinkChanges, isLinkableStatus, syncPartnerChips } from '@/lib/utils/itemLinks';
import {
  PROPOSAL_REMOVED_NOTE,
  PROPOSAL_REVIEWED_ERROR,
  isNewerVersion,
} from '@/lib/utils/proposalReview';
import { RequestTimeoutError, withRequestTimeout } from '@/lib/utils/requestTimeout';
import type { ItemDialogsControl } from '@/lib/hooks/useItemDialogs';
import type { ShownOwners } from '@/lib/utils/shownOwners';
import { cueItemCard } from '@/lib/utils/motion';
import { createSubmissionKeys, IDEMPOTENCY_HEADER } from '@/lib/utils/submissionKey';
import type { ApiItem, ApiResponse, ItemUpdate } from '@/types/api';

export interface WishlistItemActionsOptions {
  wishlistId: string | null;
  /** What the page's writes address the list by (see `useWishlistLoad`). */
  apiId: () => string;
  isOwner: boolean;
  owners: ShownOwners;
  dialogs: ItemDialogsControl;
  itemsControl: Pick<WishlistItemsControl, 'items' | 'setItems' | 'mutations' | 'handleUpdateItem'>;
}

/**
 * The wishlist page's item writes (WIS-372): add, propose, review, edit and
 * delete from the dialogs and cards, each tracked by `mutations` so the poll
 * can't undo it, and the "Goes with" options the owner's dialogs offer.
 */
export function useWishlistItemActions({
  wishlistId,
  apiId,
  isOwner,
  owners,
  dialogs,
  itemsControl,
}: WishlistItemActionsOptions) {
  const { showToast } = useToast();
  const { items, setItems, mutations, handleUpdateItem } = itemsControl;
  const { itemToEdit, itemToReview, setItemToReview, onItemRequestError } = dialogs;

  const createItemHook = useCreateItem(
    (newItem) => {
      // handleCreateItem tracks the request until after this runs, so a poll
      // whose read started before it settled is dropped instead of replacing
      // the list without the new item. One that read after the write may
      // already list it: don't add a second copy.
      setItems((prevItems) => prependCreatedItem(prevItems, newItem));
      showToast('Item added successfully', 'success');
    },
    (error) => {
      showToast(error, 'error');
    }
  );

  // No success toast here — each delete handler says what it removed, and only
  // once the delete has succeeded.
  const deleteItemHook = useDeleteItem(undefined, onItemRequestError);

  // Each dialog's Idempotency-Key: a retry of a submission whose answer was
  // lost (a timeout) sends the same one, so the server answers with the item
  // the first attempt saved instead of adding a second (WIS-158). Reset on a
  // success and when the dialog closes.
  const [addKeys] = useState(createSubmissionKeys);
  const [proposeKeys] = useState(createSubmissionKeys);

  const handleCreateItem = useCallback(
    async (itemData: {
      name: string;
      imageUrl?: string | null;
      price?: { value: number; currency: string } | null;
      link?: string | null;
      notes?: string | null;
      mostWanted?: boolean;
      status?: 'draft' | 'available';
      linkItems?: string[];
    }) => {
      if (!wishlistId) return;
      // The hook toasts a failure and resolves null. Reject so AddItemModal
      // stays open with the user's input; it closes itself on success.
      const key = addKeys.keyFor(itemData);
      const created = await mutations.track(() => createItemHook(apiId(), itemData, key));
      if (!created) throw new Error('Failed to create item');
      track('item_added', { kind: 'own' });
      // Its partners show it as theirs straight away (WIS-29).
      if (created.relatedItems?.length) setItems((prev) => syncPartnerChips(prev, created));
      addKeys.reset();
    },
    [apiId, createItemHook, wishlistId, mutations, addKeys, setItems]
  );

  // A member's reserve says what it means and where it lives (WIS-260).
  const reserveOwnerNames = useMemo(
    () => (owners.ids.length === 1 ? owners.usernames : []),
    [owners]
  );
  const handleReservableUpdate = useReserveToast<ApiItem>(
    (id, updates) => handleUpdateItem(id, updates as Partial<ApiItem>),
    { isOwner, ownerUsernames: reserveOwnerNames }
  );
  const handleCardUpdate = useReceivedToast<ApiItem>(handleReservableUpdate);

  const handleProposeItem = useCallback(
    async (itemData: {
      name: string;
      imageUrl?: string | null;
      price?: { value: number; currency: string } | null;
      link?: string | null;
      notes?: string | null;
      status: 'proposed';
    }) => {
      if (!wishlistId) return;
      const key = proposeKeys.keyFor(itemData);
      const result = await mutations.track(async (): Promise<ApiResponse<ApiItem> | null> => {
        try {
          // Given up on after ITEM_REQUEST_TIMEOUT_MS, like the hooks' requests.
          return await withRequestTimeout(async (signal) => {
            const response = await fetch(`/api/wishlists/${apiId()}/items`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                [IDEMPOTENCY_HEADER]: key,
              },
              body: JSON.stringify(itemData),
              signal,
            });

            return await response.json();
          });
        } catch (error) {
          console.error('Error proposing item:', error);
          // A timeout says so; any other failure gets the generic message.
          return {
            success: false,
            error: error instanceof RequestTimeoutError ? error.message : undefined,
          };
        }
      });

      // Every failure rejects after its toast, so ProposeItemModal stays open
      // with the user's input; it closes itself on success.
      const proposed = result?.success ? result.data : undefined;
      if (!proposed) {
        const message = result?.error || 'Failed to propose item';
        showToast(message, 'error');
        throw new Error(message);
      }
      proposeKeys.reset();
      track('item_added', { kind: 'proposal' });
      // Same poll guards as an owner's add (see createItemHook).
      setItems((prevItems) => prependCreatedItem(prevItems, proposed));
      showToast('Item proposed successfully', 'success');
    },
    [apiId, wishlistId, showToast, mutations, proposeKeys, setItems]
  );

  const handleReviewItem = useCallback(
    async (updates: Partial<ApiItem> & { status: 'draft' | 'available' }) => {
      if (!itemToReview) return;
      // A failed approve is toasted and the proposal put back by
      // handleUpdateItem. Reject so ReviewItemModal stays open with the edits
      // (it closes itself on success): the owner is told "approved" only once
      // the server agreed.
      // It expects the item to still be the proposal the dialog opened on: one a
      // co-owner has reviewed since is answered 409 and closes the dialog (see
      // onItemRequestError), so it can't overwrite their review (WIS-199).
      // And the version it shows: an edit by the proposer since is answered 409
      // with the proposal as it is now, and the dialog refills (WIS-320).
      const approved = await handleUpdateItem(itemToReview._id, updates, {
        expectProposal: true,
        expectedVersion: itemToReview.updatedAt,
      });
      if (!approved) throw new Error('Failed to approve item');
      // The owner's own Accept: its card plays the cue (WIS-407).
      cueItemCard(itemToReview._id);
      showToast(updates.status === 'draft' ? 'Added as a draft' : 'Added to the list', 'success');
    },
    [itemToReview, handleUpdateItem, showToast]
  );

  const handleDeleteProposedItem = useCallback(async () => {
    if (!itemToReview) return;
    const itemId = itemToReview._id;
    // The hook toasts a failure and resolves false. Reject so ReviewItemModal
    // stays open and the item stays listed; it closes itself on success. The
    // request is tracked, so a poll whose read started before the delete
    // settled is dropped instead of bringing the deleted item back.
    // Owner-only, so a 404 means it's already gone (see useDeleteItem).
    // Decline expects a proposal too, so it never deletes a live item a
    // co-owner approved meanwhile, possibly reserved (WIS-199).
    const deleted = await mutations.track(() =>
      deleteItemHook(itemId, { notFoundIsDone: true, expectProposal: true })
    );
    if (!deleted) throw new Error('Failed to delete item');
    setItems((prevItems) => prevItems.filter((item) => item._id !== itemId));
    showToast('Proposal declined', 'success');
  }, [itemToReview, deleteItemHook, showToast, mutations, setItems]);

  // A read brings a later version of the proposal under review (the proposer
  // edited it): the dialog refills from it, keeping the owner's own edits, and
  // says so, rather than approve fields the owner never saw (WIS-320). The
  // approve's version check covers an edit no read has brought yet.
  const liveReviewed = itemToReview
    ? items.find((item) => item._id === itemToReview._id)
    : undefined;
  useEffect(() => {
    if (liveReviewed?.status !== 'proposed') return;
    setItemToReview((current) =>
      current &&
      current._id === liveReviewed._id &&
      isNewerVersion(liveReviewed.updatedAt, current.updatedAt)
        ? liveReviewed
        : current
    );
  }, [liveReviewed, setItemToReview]);

  // A read shows the proposal under review isn't one any more: a co-owner
  // reviewed it, or it was declined or withdrawn. The dialog closes and says
  // why, never what it has become (WIS-199).
  const handleProposalGone = useCallback(
    (state: 'reviewed' | 'gone') => {
      setItemToReview(null);
      showToast(state === 'reviewed' ? PROPOSAL_REVIEWED_ERROR : PROPOSAL_REMOVED_NOTE, 'info');
    },
    [showToast, setItemToReview]
  );

  // A card's Delete / Decline, once confirmed. Rejects on failure so the
  // card keeps its item; same poll guard as the dialogs' deletes.
  const handleCardDelete = useCallback(
    async (item: ApiItem) => {
      // Owner-only, so a 404 means it's already gone (see useDeleteItem).
      const deleted = await mutations.track(() =>
        deleteItemHook(item._id, { notFoundIsDone: true })
      );
      if (!deleted) throw new Error('Failed to delete item');
      setItems((prevItems) => prevItems.filter((i) => i._id !== item._id));
      showToast(
        item.status === 'proposed' ? 'Proposal declined' : 'Item deleted successfully',
        'success'
      );
    },
    [deleteItemHook, showToast, mutations, setItems]
  );

  // The items as last rendered, for handleSaveEdit's optimistic links without
  // making it a new callback on every poll.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const handleSaveEdit = useCallback(
    async (updates: ItemUpdate) => {
      if (!itemToEdit) return;
      const itemId = itemToEdit._id;
      // Links changed (WIS-29): the card shows its new partners at once, named
      // from the list as it is.
      const changesLinks = !!(updates.linkItems || updates.unlinkItems);
      const items = itemsRef.current;
      const current = items.find((item) => item._id === itemId);
      const shown: ItemUpdate = changesLinks
        ? {
            ...updates,
            relatedItems: applyLinkChanges(
              current?.relatedItems ?? [],
              updates,
              new Map(items.map((item) => [item._id, item.name]))
            ),
          }
        : updates;
      // handleUpdateItem toasts a failure, puts the item back as it was and
      // resolves null. Reject so EditItemModal stays open with the user's
      // changes; it closes itself on success.
      const updated = await handleUpdateItem(itemId, shown);
      if (!updated) throw new Error('Failed to update item');
      // Its partners' chips follow: added, removed, or renamed with it.
      if (changesLinks || updates.name !== undefined) {
        setItems((prev) => syncPartnerChips(prev, updated));
      }
    },
    [itemToEdit, handleUpdateItem, setItems]
  );

  const handleDeleteItem = useCallback(async () => {
    if (!itemToEdit) return;
    const itemId = itemToEdit._id;
    // The hook toasts a failure and resolves false. Reject so EditItemModal
    // stays open and the item stays listed; it closes itself on success.
    // Same poll guard as handleDeleteProposedItem.
    // An owner's 404 means it's already gone, e.g. a retry whose first attempt
    // went through (WIS-158). A proposer's may be the archived list refusing
    // them, with the proposal still there, so it stays an error.
    const deleted = await mutations.track(() =>
      deleteItemHook(itemId, { notFoundIsDone: isOwner })
    );
    if (!deleted) throw new Error('Failed to delete item');
    setItems((prevItems) => prevItems.filter((item) => item._id !== itemId));
    showToast('Item deleted successfully', 'success');
  }, [itemToEdit, deleteItemHook, showToast, mutations, isOwner, setItems]);

  // What an owner's add and edit dialogs offer in "Goes with": the list's
  // items but proposals (and, editing, the item itself).
  const linkOptions = useMemo<LinkOption[] | undefined>(
    () =>
      isOwner
        ? items
            .filter((item) => isLinkableStatus(item.status))
            .map((item) => ({ id: item._id, name: item.name, imageUrl: item.imageUrl }))
        : undefined,
    [isOwner, items]
  );
  const editLinkOptions = useMemo(
    () => linkOptions?.filter((option) => option.id !== itemToEdit?._id),
    [linkOptions, itemToEdit?._id]
  );

  return {
    addKeys,
    proposeKeys,
    handleCreateItem,
    handleProposeItem,
    handleReviewItem,
    handleDeleteProposedItem,
    handleProposalGone,
    handleCardUpdate,
    handleCardDelete,
    handleSaveEdit,
    handleDeleteItem,
    linkOptions,
    editLinkOptions,
  };
}

export type WishlistItemActions = ReturnType<typeof useWishlistItemActions>;
