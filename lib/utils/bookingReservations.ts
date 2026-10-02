import type { Types } from 'mongoose';
import Item, { IItem } from '@/models/Item';
import Reservation, { type IReservation } from '@/models/Reservation';
import type { IWishlist } from '@/models/Wishlist';
import { primaryOwnerId } from '@/lib/utils/wishlistOwners';
import {
  deleteReservations,
  releaseSnapshots,
  snapshotReservationImage,
} from '@/lib/utils/reservationSnapshots';

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
 * Reservation back in step if the item has moved on. Of the two requests, the
 * one whose Reservation write lands last re-reads after both item writes, so it
 * sees how the item ended up.
 */

type BookingWishlist = Pick<IWishlist, '_id' | 'name' | 'owners'>;
type BookedItem = Pick<IItem, '_id' | 'name' | 'imageUrl' | 'price'>;

/**
 * Whether the gifter's booking of `itemId` has been released since it was
 * written, so the Reservation it created no longer belongs.
 *
 *  - `available`: unbooked. Their own unbook, or their leaving, being removed or
 *    becoming an owner, which free the item the same way. Delete it.
 *  - `booked` by someone else: it went through `available` first. Delete it.
 *  - `draft` / `completed`: an owner's status change, which unassigns the item
 *    but deliberately keeps the Reservation so the gift can still be logged.
 *    Keep it.
 *  - gone: a Reservation outlives its item. Keep it.
 */
async function bookingReleased(gifter: string, itemId: Types.ObjectId): Promise<boolean> {
  const item = await Item.findById(itemId).select('status bookedBy').lean();
  if (!item) return false;
  if (item.status === 'booked') return item.bookedBy?.toString() !== gifter;
  return item.status === 'available';
}

/**
 * A member's book has landed on `item`: write their Reservation for it. A
 * rebooking replaces the one they had, and the document as it was is returned
 * (or null), for `settleBookingReservation` to free the snapshot it held.
 */
export async function writeBookingReservation(
  gifter: string,
  wishlist: BookingWishlist,
  item: BookedItem
) {
  // Awaited as is (`lean` as an option, not chained), so a race test can hold it.
  return Reservation.findOneAndUpdate(
    { gifter, item: item._id },
    {
      $set: {
        gifter,
        wishlist: wishlist._id,
        item: item._id,
        // Snapshot of the recipient. A co-owned list has several owners, so
        // this pins the primary one — a `GiftLog` records one recipient, and
        // the snapshot deliberately doesn't follow later ownership changes.
        owner: primaryOwnerId(wishlist),
        itemName: item.name,
        itemImage: item.imageUrl ?? null,
        itemPrice: item.price ?? null,
        wishlistName: wishlist.name,
      },
    },
    // The document as it was, so a rebooking can free the snapshot it replaces.
    { upsert: true, new: false, lean: true }
  );
}

/**
 * The rest of a booking, once `writeBookingReservation` has written its
 * Reservation: free the snapshot the write replaced (`previous`), then give the
 * Reservation its own copy of the item's image. If the booking has been released
 * meanwhile (see `bookingReleased`), the Reservation is deleted instead. This
 * only ever ends the Reservation, never writes one back.
 */
export async function settleBookingReservation(
  gifter: string,
  item: Pick<IItem, '_id' | 'imageUrl'>,
  previous: Pick<IReservation, 'itemImage'> | null
): Promise<void> {
  if (previous) await releaseSnapshots(gifter, [previous.itemImage]);

  // Checked before the image copy, which can take seconds: a release landing
  // after this read finds the Reservation and deletes it itself.
  if (await bookingReleased(gifter, item._id)) {
    await deleteReservations({ gifter, item: item._id });
    return;
  }

  // Swap in our own copy of the image, since the owner frees the item's blob
  // when they delete the item or replace its image.
  await snapshotReservationImage(gifter, item._id, item.imageUrl);
}

/**
 * A member's unbook has landed on the item: delete their Reservation for it. If
 * they've booked it again meanwhile (from another tab), the delete may have
 * taken that booking's Reservation, so it's written again, as that booking
 * would have written it.
 */
export async function cancelUnbookedReservation(
  gifter: string,
  wishlist: BookingWishlist,
  itemId: Types.ObjectId
): Promise<void> {
  await deleteReservations({ gifter, item: itemId });

  const item = await Item.findById(itemId).select('name imageUrl price status bookedBy').lean();
  if (item?.status === 'booked' && item.bookedBy?.toString() === gifter) {
    const previous = await writeBookingReservation(gifter, wishlist, item);
    await settleBookingReservation(gifter, item, previous);
  }
}
