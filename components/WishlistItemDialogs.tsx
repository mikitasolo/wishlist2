'use client';

import AddItemModal from '@/components/AddItemModal';
import EditItemModal from '@/components/EditItemModal';
import ProposeItemModal from '@/components/ProposeItemModal';
import ReviewItemModal from '@/components/ReviewItemModal';
import SaveToListModal from '@/components/SaveToListModal';
import type { ItemDialogsControl } from '@/lib/hooks/useItemDialogs';
import type { WishlistItemActions } from '@/lib/hooks/useWishlistItemActions';
import type { WishlistItemsControl } from '@/lib/hooks/useWishlistItems';
import { proposalReviewState } from '@/lib/utils/proposalReview';

export interface WishlistItemDialogsProps {
  dialogs: ItemDialogsControl;
  actions: WishlistItemActions;
  itemsControl: Pick<WishlistItemsControl, 'items' | 'mutations'>;
  isOwner: boolean;
  wishlistCurrency: string | undefined;
  userCurrency: string | undefined;
}

/**
 * The wishlist page's item dialogs (WIS-372): add, propose, edit, review a
 * proposal, and Save to my list. Rendered by the page whatever the tab, as
 * the header's Add item opens one from any of them.
 */
export default function WishlistItemDialogs({
  dialogs,
  actions,
  itemsControl: { items, mutations },
  isOwner,
  wishlistCurrency,
  userCurrency,
}: WishlistItemDialogsProps) {
  const {
    showAddItemModal,
    setShowAddItemModal,
    showProposeItemModal,
    setShowProposeItemModal,
    itemToEdit,
    setItemToEdit,
    editOnLink,
    itemToReview,
    setItemToReview,
    itemToSave,
    setItemToSave,
  } = dialogs;
  const { addKeys, proposeKeys } = actions;

  return (
    <>
      {showAddItemModal && (
        <AddItemModal
          isOpen={showAddItemModal}
          onClose={() => {
            addKeys.reset();
            setShowAddItemModal(false);
          }}
          onAdd={actions.handleCreateItem}
          wishlistCurrency={wishlistCurrency}
          userCurrency={userCurrency}
          linkOptions={actions.linkOptions}
        />
      )}

      {showProposeItemModal && (
        <ProposeItemModal
          isOpen={showProposeItemModal}
          onClose={() => {
            proposeKeys.reset();
            setShowProposeItemModal(false);
          }}
          onPropose={actions.handleProposeItem}
          wishlistCurrency={wishlistCurrency}
          userCurrency={userCurrency}
        />
      )}

      {itemToEdit && (
        <EditItemModal
          isOpen={!!itemToEdit}
          onClose={() => setItemToEdit(null)}
          initialFocus={editOnLink ? 'link' : undefined}
          onSave={actions.handleSaveEdit}
          onDelete={actions.handleDeleteItem}
          item={itemToEdit}
          wishlistCurrency={wishlistCurrency}
          userCurrency={userCurrency}
          linkOptions={isOwner ? actions.editLinkOptions : undefined}
        />
      )}

      {itemToReview && (
        <ReviewItemModal
          isOpen={!!itemToReview}
          onClose={() => setItemToReview(null)}
          onApprove={actions.handleReviewItem}
          onDelete={actions.handleDeleteProposedItem}
          proposalState={proposalReviewState(items, itemToReview._id)}
          onProposalGone={actions.handleProposalGone}
          item={itemToReview}
          wishlistCurrency={wishlistCurrency}
          userCurrency={userCurrency}
        />
      )}

      {itemToSave && (
        <SaveToListModal
          item={itemToSave}
          userCurrency={userCurrency}
          mutations={mutations}
          onClose={() => setItemToSave(null)}
        />
      )}
    </>
  );
}
