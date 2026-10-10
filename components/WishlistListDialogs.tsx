'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import StartFromListModal from '@/components/StartFromListModal';
import { ARCHIVE_EXPLANATION } from '@/components/WishlistSettingsTab';
import type { WishlistListActions } from '@/lib/hooks/useWishlistListActions';
import { deleteListCopy, memberLeaveCopy, ownerLeaveCopy } from '@/lib/utils/confirmationCopy';
import type { IWishlist } from '@/models/Wishlist';

export interface WishlistListDialogsProps {
  wishlist: IWishlist;
  actions: WishlistListActions;
  closeDeleteConfirm: () => void;
  isOwner: boolean;
  /** The list has members besides its owners (the sole owner's notice). */
  hasMembers: boolean;
  /** Items the viewer has reserved here, once the items have been read. */
  reservedByYou: number | null;
  /** Discreet mode: Leave list names no count. */
  hideReservations: boolean;
  /** Every item on the list, once read: Delete's count. */
  itemCount: number | null;
}

/**
 * The confirmations for the list as a whole on the wishlist page (WIS-372):
 * Leave list (or why the sole owner can't), Archive, Delete and Start a new
 * list. Only the leaving member's own dialog carries a count of reserved
 * gifts: an owner's never does.
 */
export default function WishlistListDialogs({
  wishlist,
  actions,
  closeDeleteConfirm,
  isOwner,
  hasMembers,
  reservedByYou,
  hideReservations,
  itemCount,
}: WishlistListDialogsProps) {
  const {
    listConfirm,
    confirmLeaveWishlist,
    confirmDeleteWishlist,
    soleOwnerNotice,
    setSoleOwnerNotice,
    inviteCoOwnerInstead,
    startNewOpen,
    setStartNewOpen,
    setArchived,
    archiveConfirm,
    setArchiveConfirm,
    confirmArchive,
  } = actions;

  return (
    <>
      {listConfirm === 'leave' && (
        <ConfirmDialog
          isOpen={!!listConfirm}
          {...(isOwner
            ? ownerLeaveCopy(wishlist.name)
            : // Their own reservations, from the items already on the page.
              memberLeaveCopy(wishlist.name, reservedByYou, hideReservations))}
          onConfirm={confirmLeaveWishlist}
          onCancel={closeDeleteConfirm}
          confirmText="Leave"
          pendingText="Leaving…"
          cancelText="Cancel"
          type="danger"
          icon="logout"
        />
      )}

      {soleOwnerNotice && (
        <ConfirmDialog
          isOpen={soleOwnerNotice}
          title="You're the only owner"
          // A member is the likeliest successor, and inviting one is refused
          // ("promote them from the members list"), so the way to them comes first.
          message={
            hasMembers
              ? 'A wishlist needs at least one owner. To leave, make someone else an owner first: pick Make owner in one of your members’ menus on People, or invite a co-owner. Once they accept, you can leave. Or delete the wishlist instead.'
              : 'A wishlist needs at least one owner. To leave, invite a co-owner first; once they accept, you can leave. Or delete the wishlist instead.'
          }
          onConfirm={inviteCoOwnerInstead}
          onCancel={() => setSoleOwnerNotice(false)}
          confirmText="Invite a co-owner"
          cancelText="Cancel"
          type="info"
        />
      )}

      {startNewOpen && isOwner && (
        <StartFromListModal
          sourceId={String(wishlist._id)}
          isOpen={startNewOpen}
          onClose={() => setStartNewOpen(false)}
          onArchiveSource={() => setArchived(true)}
        />
      )}

      {archiveConfirm && (
        <ConfirmDialog
          isOpen={archiveConfirm}
          title="Archive wishlist?"
          message={ARCHIVE_EXPLANATION}
          onConfirm={confirmArchive}
          onCancel={() => setArchiveConfirm(false)}
          confirmText="Archive"
          pendingText="Archiving…"
          cancelText="Cancel"
          type="warning"
        />
      )}

      {listConfirm === 'wishlist' && (
        <ConfirmDialog
          isOpen={!!listConfirm}
          // Every item goes, drafts and proposals too. Reservations stay (they're
          // the gifters'), and an owner is told nothing about them.
          {...deleteListCopy(wishlist.name, itemCount)}
          onConfirm={confirmDeleteWishlist}
          onCancel={closeDeleteConfirm}
          confirmText="Delete"
          pendingText="Deleting…"
          cancelText="Cancel"
          type="danger"
        />
      )}
    </>
  );
}
