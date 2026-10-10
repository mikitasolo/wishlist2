'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import type { ItemRequestFailure } from '@/lib/hooks/useItems';
import { isNewerVersion } from '@/lib/utils/proposalReview';
import type { ApiItem } from '@/types/api';

/**
 * Which item dialog the wishlist page has open (WIS-372), and what a refused
 * item request does to the review dialog. Called before `useWishlistItems`,
 * whose `updateItem` reports its failures through `onItemRequestError`.
 */
export function useItemDialogs() {
  const { showToast } = useToast();
  const [itemToEdit, setItemToEdit] = useState<ApiItem | null>(null);
  // Edit opened from a card's "+ link" starts on the Link field.
  const [editOnLink, setEditOnLink] = useState(false);
  const [itemToReview, setItemToReview] = useState<ApiItem | null>(null);
  // "Save to my list": the item being copied to one of the viewer's own lists.
  const [itemToSave, setItemToSave] = useState<ApiItem | null>(null);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showProposeItemModal, setShowProposeItemModal] = useState(false);

  // No success refetch here — handleUpdateItem merges the server response into
  // the single item, avoiding a full-list refetch that races with polling.
  // A review request refused because the item is no longer a proposal (a
  // co-owner reviewed it meanwhile) closes the review dialog: what it shows is
  // gone, and the toast (the server's PROPOSAL_REVIEWED_ERROR) says why. Its
  // edits are dropped with it (WIS-199). Only one review dialog is ever open,
  // and it can't be closed while its request runs.
  const onItemRequestError = useCallback(
    (error: string, failure: ItemRequestFailure) => {
      showToast(error, 'error');
      if (failure.proposalReviewed) setItemToReview(null);
      // Edited by the proposer since the dialog was filled (WIS-320): it stays
      // open and refills from the proposal as it is now, so the owner sees the
      // edit before approving.
      const edited = failure.editedProposal;
      if (edited) {
        setItemToReview((current) =>
          current &&
          current._id === edited._id &&
          isNewerVersion(edited.updatedAt, current.updatedAt)
            ? edited
            : current
        );
      }
    },
    [showToast]
  );

  const handleEditItem = useCallback((item: ApiItem) => {
    setEditOnLink(false);
    setItemToEdit(item);
  }, []);

  const handleAddItemLink = useCallback((item: ApiItem) => {
    setEditOnLink(true);
    setItemToEdit(item);
  }, []);

  return {
    itemToEdit,
    setItemToEdit,
    editOnLink,
    itemToReview,
    setItemToReview,
    itemToSave,
    setItemToSave,
    showAddItemModal,
    setShowAddItemModal,
    showProposeItemModal,
    setShowProposeItemModal,
    onItemRequestError,
    handleEditItem,
    handleAddItemLink,
  };
}

export type ItemDialogsControl = ReturnType<typeof useItemDialogs>;
