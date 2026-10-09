import type { Types } from 'mongoose';
import Item from '@/models/Item';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Reservation, { type IReservation } from '@/models/Reservation';
import { deleteReservations, releaseSnapshots } from '@/lib/utils/reservationSnapshots';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import { isHiddenByArchive } from '@/lib/utils/wishlistAccess';

type Id = string | Types.ObjectId;

/** What a booking's Reservation write replaced, for putting it back. */
type PreviousReservation = Pick<
  IReservation,
  'wishlist' | 'owner' | 'itemName' | 'itemImage' | 'itemPrice' | 'wishlistName'
>;

/**
 * Why a member's booking that has just been written can't stand, because the
 * caller stopped being a plain member of the list while the request was in flight:
 *
 *   - owner      → they became an owner (accepted a promotion).
 *   - archived   → an owner archived the list, which hides it from members.
 *   - not-member → they left, were removed, or their membership has been taken
 *                  by a promotion whose grant hasn't landed yet.
 */
export type LostBookingReason = 'owner' | 'archived' | 'not-member';

/**
 * Why `userId` is no longer a plain member of the list, read now: what
 * `undoBookingUnlessMember` and a group gift's start or join (WIS-361) check
 * once their writes have landed. `null` when they still are one, or the list is
 * gone (its items go with it, so nothing is stranded).
 */
export async function lostMemberReason(
  wishlistId: Id,
  userId: string
): Promise<LostBookingReason | null> {
  // The membership first. Deleting a list removes the list before its memberships,
  // so a row that's gone because the list was deleted can't be followed by a read
  // that still finds the list.
  const membership = await WishlistMember.exists({ wishlist: wishlistId, user: userId });
  const wishlist = await Wishlist.findById(wishlistId).select('owners archived').lean();
  if (!wishlist) return null;
  if (isWishlistOwner(wishlist, userId)) return 'owner';
  if (isHiddenByArchive(wishlist, userId)) return 'archived';
  if (!membership) return 'not-member';
  return null;
}

/**
 * Re-check, once a member's booking has written the item and its Reservation, that
 * they're still a plain member of the list, and undo the booking if not. Returns
 * why it was undone, or `null` when it stands.
 *
 * The booking route decides the caller is a member from reads at the top of the
 * request, and its writes land later. A role change in between would otherwise
 * strand the item: booked by someone who can't release it (a non-member gets a 403
 * on the item, a member of an archived list a 404), or held by an owner, who is
 * booking-blind and can't be their own gifter. The paths that change the role
 * release bookings themselves, but only the ones written by then. This covers the
 * ones written later, in two halves:
 *
 *   - Becoming an owner grants the ownership before it releases the bookings
 *     (`promoteMemberToOwner`, `addWishlistOwner`). So this check, which runs after
 *     the booking's writes, either sees them as an owner or ran before the grant,
 *     and then the release that follows the grant frees what it wrote.
 *   - Leaving or being removed frees the bookings before the membership delete,
 *     and again after it (`releaseLateBookings`). This check sees the row gone, or
 *     ran before the delete, and then the second release frees the item.
 *
 * Archiving releases nothing, so a booking this check passed before the archive
 * stands, as one made before archiving always has. A deleted list isn't a reason
 * either: its items go with it, so nothing is stranded, and the delete keeps the
 * reservations on purpose.
 *
 * The undo is a conditional write, so it can't free an item that's since been
 * booked by someone else or moved on by an owner. It then ends the Reservation
 * this booking wrote, through `deleteReservations`. A rebooking over a reservation
 * an owner's status change kept overwrote that one instead (`previous`, the
 * document as it was): it's put back as it was, as the role change would have left
 * it, unless they're now an owner, who holds no reservation on their own list
 * (`releaseGifterHoldings`).
 *
 * Runs before the booking frees the snapshot it overwrote and copies the item's
 * image for its own (`snapshotReservationImage`), so an undone booking copies
 * nothing and a restored reservation gets its snapshot back. A role change during
 * that copy is the release paths' to settle, since both writes are done.
 */
export async function undoBookingUnlessMember({
  wishlistId,
  itemId,
  gifterId,
  previous,
}: {
  wishlistId: Id;
  itemId: Id;
  gifterId: string;
  previous: PreviousReservation | null;
}): Promise<LostBookingReason | null> {
  const reason = await lostMemberReason(wishlistId, gifterId);
  if (!reason) return null;

  // The item first: a reservation left behind is one the gifter can dismiss from
  // their Booked page, while an item left booked is the stranding this undoes.
  // Never a group gift's item: those are undone through the gift
  // (`lib/utils/groupGifts.ts`).
  await Item.updateOne(
    { _id: itemId, status: 'booked', bookedBy: gifterId, groupGift: null },
    { $set: { status: 'available', bookedBy: null } }
  );
  if (previous && reason !== 'owner') {
    const { wishlist: list, owner, itemName, itemImage, itemPrice, wishlistName } = previous;
    await Reservation.updateOne(
      { gifter: gifterId, item: itemId },
      { $set: { wishlist: list, owner, itemName, itemImage, itemPrice, wishlistName } }
    );
  } else {
    await deleteReservations({ gifter: gifterId, item: itemId });
  }
  // The snapshot the booking overwrote, unless the reservation holds it again:
  // freed after a delete, or when the gifter dismissed or logged it meanwhile.
  if (previous) await releaseSnapshots(gifterId, [previous.itemImage]);
  return reason;
}
