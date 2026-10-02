import type { Types } from 'mongoose';
import Item, { IItem } from '@/models/Item';
import Reservation, { type IReservation } from '@/models/Reservation';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { isWishlistOwner, primaryOwnerId } from '@/lib/utils/wishlistOwners';
import {
  deleteReservations,
  releaseSnapshots,
  snapshotReservationImage,
} from '@/lib/utils/reservationSnapshots';
import { errorKind } from '@/lib/utils/errorKind';

/**
 * Keeping a member's durable `Reservation` in step with their own book or
 * unbook (`PATCH /api/items/[id]`), once its item write has landed.
 *
 * The item write and the Reservation write are two separate steps, so when the
 * same person books and unbooks one item at once (two tabs or devices), the
 * other request's writes can land between them:
 *
 *  - book's item write, then the unbook's item write and its Reservation delete
 *    (which finds nothing yet), then the book's Reservation write: the item is
 *    available, yet they hold a Reservation for it, and someone else booking it
 *    leaves two people holding one item.
 *  - unbook's item write, then the book's item write and Reservation write, then
 *    the unbook's Reservation delete: the item is booked by them, but missing
 *    from their Booked page.
 *
 * So each side re-reads the item after its own Reservation write and puts the
 * Reservation back the way the later of the two item writes would have left it.
 * Of the two requests, the one whose Reservation write lands last re-reads after
 * both item writes, so it sees how the item ended up.
 *
 * The re-checks are repairs for a rare race, so they're best-effort: one that
 * fails is logged and leaves things as the write left them, rather than turning
 * a book or unbook that landed into an error.
 */

type BookingWishlist = Pick<IWishlist, '_id' | 'name' | 'owners'>;
type BookedItem = Pick<IItem, '_id' | 'name' | 'imageUrl' | 'price'>;

const isBookedBy = (item: Pick<IItem, 'status' | 'bookedBy'>, gifter: string) =>
  item.status === 'booked' && item.bookedBy?.toString() === gifter;

/**
 * A booking's Reservation, as it's written. Not `gifter` or `item`: an upsert
 * takes those from its filter, and leaving them out of the update lets the
 * server retry an upsert that collides with a concurrent one on that unique key.
 */
function reservationFields(wishlist: BookingWishlist, item: BookedItem) {
  return {
    wishlist: wishlist._id,
    // Snapshot of the recipient. A co-owned list has several owners, so this
    // pins the primary one — a `GiftLog` records one recipient, and the
    // snapshot deliberately doesn't follow later ownership changes.
    owner: primaryOwnerId(wishlist),
    itemName: item.name,
    itemImage: item.imageUrl ?? null,
    itemPrice: item.price ?? null,
    wishlistName: wishlist.name,
  };
}

/**
 * Whether the gifter's booking of `itemId` was released after its item write,
 * so the Reservation the booking then wrote no longer belongs. Read from the
 * item, and, when it's free, from who the gifter now is on the list:
 *
 *  - still booked by them, or gone (a Reservation outlives its item): no.
 *  - `draft` / `completed`: an owner's status change, which unassigns the item
 *    but keeps the Reservation so the gift can still be logged: no.
 *  - `available`, or booked by someone else since, while they're:
 *      - still a member: their own unbook from another tab: yes. (An owner
 *        reopening the item in that instant looks the same, and counts as one.)
 *      - now an owner: becoming one cancels their reservations: yes.
 *      - off the list (left or removed, which keep the Reservation), or the
 *        list is being deleted (which keeps it too): no.
 */
export async function bookingWasReleased(
  gifter: string,
  wishlistId: Types.ObjectId,
  itemId: Types.ObjectId
): Promise<boolean> {
  const item = await Item.findById(itemId).select('status bookedBy').lean();
  if (!item || isBookedBy(item, gifter)) return false;
  if (item.status !== 'available' && item.status !== 'booked') return false;

  const [membership, wishlist] = await Promise.all([
    WishlistMember.exists({ wishlist: wishlistId, user: gifter }),
    Wishlist.findById(wishlistId).select('owners').lean(),
  ]);
  if (!wishlist) return false;
  return !!membership || isWishlistOwner(wishlist, gifter);
}

/**
 * A member's book has landed on `item`: write their Reservation for it. A
 * rebooking replaces the one they had, and the document as it was is returned
 * (or null), for `settleBookingReservation` to free the snapshot it held. The
 * two are separate steps so that a check on the booking can run between them.
 */
export async function writeBookingReservation(
  gifter: string,
  wishlist: BookingWishlist,
  item: BookedItem
) {
  // Awaited as is (`lean` as an option, not chained), so a race test can hold it.
  return Reservation.findOneAndUpdate(
    { gifter, item: item._id },
    { $set: reservationFields(wishlist, item) },
    // The document as it was, so a rebooking can free the snapshot it replaces.
    { upsert: true, new: false, lean: true }
  );
}

/**
 * The rest of a booking, once `writeBookingReservation` has written its
 * Reservation: free the snapshot the write replaced (`previous`), then give the
 * Reservation its own copy of the item's image. If the booking has been released
 * meanwhile (see `bookingWasReleased`), the Reservation is deleted instead. This
 * only ever ends the Reservation, never writes one back.
 */
export async function settleBookingReservation(
  gifter: string,
  wishlist: Pick<IWishlist, '_id'>,
  item: Pick<IItem, '_id' | 'imageUrl'>,
  previous: Pick<IReservation, 'itemImage'> | null
): Promise<void> {
  if (previous) await releaseSnapshots(gifter, [previous.itemImage]);

  // Checked before the image copy, which can take seconds: a release landing
  // after this read finds the Reservation and deletes it itself.
  let released = false;
  try {
    released = await bookingWasReleased(gifter, wishlist._id, item._id);
    if (released) await deleteReservations({ gifter, item: item._id });
  } catch (err) {
    console.error('Re-checking a booking against its item failed:', errorKind(err));
  }
  if (released) return;

  // Swap in our own copy of the image, since the owner frees the item's blob
  // when they delete the item or replace its image.
  await snapshotReservationImage(gifter, item._id, item.imageUrl);
}

/**
 * A member's unbook has landed on the item: delete their Reservation for it. If
 * they've booked it again meanwhile (from another tab), the delete may have
 * taken that booking's Reservation, so it's written again.
 */
export async function cancelUnbookedReservation(
  gifter: string,
  wishlist: BookingWishlist,
  itemId: Types.ObjectId
): Promise<void> {
  await deleteReservations({ gifter, item: itemId });

  try {
    const item = await Item.findById(itemId).select('name imageUrl price status bookedBy').lean();
    if (!item || !isBookedBy(item, gifter)) return;
    // Only if it's missing: a rebooking whose own write landed after the delete
    // above already holds the right one, snapshot included.
    const existing = await Reservation.findOneAndUpdate(
      { gifter, item: itemId },
      { $setOnInsert: reservationFields(wishlist, item) },
      { upsert: true, new: false, lean: true }
    );
    if (!existing) await settleBookingReservation(gifter, wishlist, item, null);
  } catch (err) {
    console.error('Re-checking an unbook against its item failed:', errorKind(err));
  }
}
