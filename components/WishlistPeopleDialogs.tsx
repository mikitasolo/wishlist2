'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import RevokeShareLinksDialog from '@/components/RevokeShareLinksDialog';
import type { ShareLinksControl } from '@/lib/hooks/useShareLinks';
import type { WishlistPeopleControl } from '@/lib/hooks/useWishlistPeople';

export interface WishlistPeopleDialogsProps {
  people: WishlistPeopleControl;
  shareLinks: Pick<ShareLinksControl, 'links' | 'revoke'>;
  /** The page's removal confirmation (see `DeleteConfirm`), while open. */
  deleteConfirmOpen: boolean;
}

/**
 * People's dialogs on the wishlist page (WIS-372): Make owner, and the offer to
 * revoke share links after a removal or demotion has gone through. Remove and
 * Make member have an Undo toast instead of a confirmation (WIS-387, see
 * `useWishlistPeople`).
 */
export default function WishlistPeopleDialogs({
  people,
  shareLinks,
  deleteConfirmOpen,
}: WishlistPeopleDialogsProps) {
  const {
    promoteConfirm,
    setPromoteConfirm,
    confirmPromoteToOwner,
    revokeLinksFor,
    setRevokeLinksFor,
  } = people;

  return (
    <>
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

      {/* Never stacked on another confirmation. */}
      {revokeLinksFor && !promoteConfirm && !deleteConfirmOpen && (
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
