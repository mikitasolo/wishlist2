'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import RevokeShareLinksDialog from '@/components/RevokeShareLinksDialog';
import type { ShareLinksControl } from '@/lib/hooks/useShareLinks';
import type { WishlistPeopleControl } from '@/lib/hooks/useWishlistPeople';
import { removeFromListCopy } from '@/lib/utils/confirmationCopy';

export interface WishlistPeopleDialogsProps {
  people: WishlistPeopleControl;
  shareLinks: Pick<ShareLinksControl, 'links' | 'revoke'>;
  /** The page's removal confirmation (see `DeleteConfirm`), while open. */
  deleteConfirmOpen: boolean;
  closeDeleteConfirm: () => void;
}

/**
 * People's confirmations on the wishlist page (WIS-372): Remove, Make owner,
 * Make member, and the offer to revoke share links after a removal or
 * demotion. Each says what its action keeps as well as what it takes
 * (lib/utils/confirmationCopy.ts).
 */
export default function WishlistPeopleDialogs({
  people,
  shareLinks,
  deleteConfirmOpen,
  closeDeleteConfirm,
}: WishlistPeopleDialogsProps) {
  const {
    removeConfirm,
    confirmKickMember,
    promoteConfirm,
    setPromoteConfirm,
    confirmPromoteToOwner,
    demoteConfirm,
    setDemoteConfirm,
    confirmDemoteOwner,
    revokeLinksFor,
    setRevokeLinksFor,
    hasLiveLinks,
  } = people;

  return (
    <>
      {removeConfirm && (
        <ConfirmDialog
          isOpen={!!removeConfirm}
          {...removeFromListCopy(removeConfirm.memberUsername, removeConfirm.type, {
            liveLinks: hasLiveLinks,
          })}
          onConfirm={confirmKickMember}
          onCancel={closeDeleteConfirm}
          confirmText="Remove"
          pendingText="Removing…"
          cancelText="Cancel"
          type="danger"
          icon="user-minus"
        />
      )}

      {promoteConfirm && (
        <ConfirmDialog
          isOpen={!!promoteConfirm}
          title="Make owner?"
          message={`@${promoteConfirm.username} will get the same full control you have — including deleting this wishlist — and it will appear on their profile as their own. Because owners can never see reservations, anything they've reserved here will be released and their reservations cancelled. They have to accept the invitation first, and only another owner can undo it.`}
          onConfirm={confirmPromoteToOwner}
          onCancel={() => setPromoteConfirm(null)}
          confirmText="Send owner invite"
          pendingText="Sending…"
          cancelText="Cancel"
          type="warning"
        />
      )}

      {demoteConfirm && (
        <ConfirmDialog
          isOpen={!!demoteConfirm}
          title={`Make @${demoteConfirm.username || 'user'} a member?`}
          message="They keep access and can reserve gifts, but can no longer edit or manage the list. They'll be notified. Making them an owner again needs their acceptance."
          onConfirm={confirmDemoteOwner}
          onCancel={() => setDemoteConfirm(null)}
          confirmText="Make member"
          pendingText="Making member…"
          cancelText="Cancel"
          type="warning"
        />
      )}

      {/* After its confirmation has closed, never stacked on it. */}
      {revokeLinksFor && !demoteConfirm && !deleteConfirmOpen && (
        <RevokeShareLinksDialog
          username={revokeLinksFor.username}
          links={shareLinks.links}
          onRevoke={shareLinks.revoke}
          onDone={() => setRevokeLinksFor(null)}
        />
      )}
    </>
  );
}
