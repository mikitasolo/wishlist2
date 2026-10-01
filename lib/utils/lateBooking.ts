import type { Types } from 'mongoose';
import Item from '@/models/Item';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { deleteReservations } from '@/lib/utils/reservationSnapshots';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import { isHiddenByArchive } from '@/lib/utils/wishlistAccess';

type Id = string | Types.ObjectId;

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
 * this booking wrote, through `deleteReservations`, which frees its snapshot. A
 * reservation that was already there before the booking (`createdReservation:
 * false`, a rebooking over one an owner's status change kept) stays, as the role
 * change would have kept it, unless they're now an owner: an owner holds no
 * reservation on their own list (`releaseGifterHoldings`).
 *
 * Runs before the booking copies the item's image for its reservation
 * (`snapshotReservationImage`), so an undone booking copies nothing. A role change
 * during that copy is the release paths' to settle, since both writes are done.
 */
export async function undoBookingUnlessMember({
  wishlistId,
  itemId,
  gifterId,
  createdReservation,
}: {
  wishlistId: Id;
  itemId: Id;
  gifterId: string;
  createdReservation: boolean;
}): Promise<LostBookingReason | null> {
  // The membership first. Deleting a list removes the list before its memberships,
  // so a row that's gone because the list was deleted can't be followed by a read
  // that still finds the list.
  const membership = await WishlistMember.exists({ wishlist: wishlistId, user: gifterId });
  const wishlist = await Wishlist.findById(wishlistId).select('owners archived').lean();
  if (!wishlist) return null;

  let reason: LostBookingReason | null = null;
  if (isWishlistOwner(wishlist, gifterId)) reason = 'owner';
  else if (isHiddenByArchive(wishlist, gifterId)) reason = 'archived';
  else if (!membership) reason = 'not-member';
  if (!reason) return null;

  // The item first: a reservation left behind is one the gifter can dismiss from
  // their Booked page, while an item left booked is the stranding this undoes.
  await Item.updateOne(
    { _id: itemId, status: 'booked', bookedBy: gifterId },
    { $set: { status: 'available', bookedBy: null } }
  );
  if (reason === 'owner' || createdReservation) {
    await deleteReservations({ gifter: gifterId, item: itemId });
  }
  return reason;
}
