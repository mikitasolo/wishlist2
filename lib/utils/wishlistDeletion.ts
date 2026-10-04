import Wishlist, { type IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import WishlistJoinRequest from '@/models/WishlistJoinRequest';
import Notification from '@/models/Notification';
import Item from '@/models/Item';
import { deleteOwnBlob, deleteOwnBlobs } from '@/lib/utils/blob';
import { ownedByFilter } from '@/lib/utils/wishlistOwners';
import { purgeShareCards } from '@/lib/og/purge';

/**
 * Deleting a wishlist: the one path every delete goes through, the list's own
 * `DELETE /api/wishlists/[id]` and an account deletion's lists owned alone
 * (`lib/utils/accountDeletion.ts`).
 *
 * The delete is its own ownership check: it only matches while `userId` still
 * owns the list. A check against a copy read earlier would race: a co-owner
 * removing them a moment before wouldn't stop it. So the list goes first, and
 * nothing else is touched unless it did. `soleOwner` also requires them to be
 * its only owner, so an account deletion never deletes a list someone became a
 * co-owner of since it was read (that one only loses this owner instead).
 *
 * Returns the deleted list, or `null` when nothing matched and nothing changed.
 */
export async function deleteOwnedWishlist(
  wishlistId: string,
  userId: string,
  { soleOwner = false }: { soleOwner?: boolean } = {}
): Promise<IWishlist | null> {
  const wishlist = await Wishlist.findOneAndDelete({
    _id: wishlistId,
    ...ownedByFilter(userId),
    ...(soleOwner ? { 'owners.1': { $exists: false } } : {}),
  });
  if (!wishlist) return null;

  // Best-effort cleanup of what only made sense while the list existed. The
  // list is already gone, so each step logs and continues: a failure here
  // must not turn a successful delete into an error. Whatever a failed step
  // leaves behind points at a list that no longer exists, so nothing can
  // reach it.
  //  - Items, and their uploaded images.
  //  - Memberships.
  //  - Invites, whatever their status (accepted/declined rows are only
  //    history for a list that no longer exists).
  //  - Requests to join, pending or declined (an ask that lands after this
  //    takes its own row back: POST /requests re-checks the list).
  //  - Notifications that link to the list, which would now 404 (the
  //    `wishlist_invite` ones even look actionable). One that a request
  //    already past its checks writes after this is taken back by
  //    `createNotification(s)` (lib/notifications.ts), which re-checks the
  //    list once it's written.
  //  - Our own uploaded cover image.
  // Reservations and gift logs deliberately stay: they're the gifter's, so
  // they can still see what they claimed and log the gift.
  await Promise.all([
    bestEffort('Item', wishlistId, () => deleteItemsAndImages(wishlistId)),
    bestEffort('Membership', wishlistId, () => WishlistMember.deleteMany({ wishlist: wishlistId })),
    bestEffort('Invite', wishlistId, () => WishlistInvite.deleteMany({ wishlist: wishlistId })),
    bestEffort('Join request', wishlistId, () =>
      WishlistJoinRequest.deleteMany({ wishlist: wishlistId })
    ),
    bestEffort('Notification', wishlistId, () => Notification.deleteMany({ wishlist: wishlistId })),
    deleteOwnBlob(wishlist.bannerUrl),
    // Its cached share card, which would otherwise go on naming it for a day.
    purgeShareCards({ wishlistIds: [wishlistId] }),
  ]);
  return wishlist;
}

/** Run one cleanup step after a wishlist delete; log and swallow a failure. */
async function bestEffort(
  what: string,
  wishlistId: string,
  step: () => PromiseLike<unknown>
): Promise<void> {
  try {
    await step();
  } catch (err) {
    console.error(`${what} cleanup failed for deleted wishlist ${wishlistId}:`, err);
  }
}

/** Delete a deleted list's items, then free the images uploaded for them. */
async function deleteItemsAndImages(wishlistId: string): Promise<void> {
  // Collected before the items go, or their blobs would be orphaned in storage.
  const items = await Item.find({ wishlist: wishlistId }).select('imageUrl').lean();
  await Item.deleteMany({ wishlist: wishlistId });
  await deleteOwnBlobs(items.map((i) => i.imageUrl));
}
