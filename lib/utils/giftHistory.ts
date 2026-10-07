import type { Types } from 'mongoose';
import GiftLog, { type IGiftLog } from '@/models/GiftLog';
import Reservation, { type IReservation } from '@/models/Reservation';
import { errorKind } from '@/lib/utils/errorKind';
import { isOwnBlob, isSnapshotBlob } from '@/lib/utils/blob';
import { readReservationWishlists } from '@/lib/utils/reservationWishlists';

// Server-side shaping of the gifter's gift history (`GiftLog`), shared by the
// routes that return an entry: `GET /api/users/me/gifts` lists them, and
// `POST /api/reservations/[id]/gift` returns the one it wrote, which the Booked
// page adds to its copy of the list as is. Both must give an entry the same
// shape, so build it only here.

/**
 * Of `itemIds`, the items a member holds the booking of, the ones whose booking
 * `gifterId` has marked as given, as strings: their own gift history
 * (`GiftLog.item`) has the item, and they hold no Reservation for it. Marking
 * a gift ends the booking's Reservation (it becomes the `GiftLog` entry), so a
 * booking that still has one is a newer one, not given yet, even if an earlier
 * booking of the same item was: a wish the owner reopened, or one they released
 * and reserved again.
 *
 * For the "Given by you" flag a member's own read of a list's items carries
 * (`givenByMe`), so a given gift isn't offered back up with an Unbook. It reads
 * nobody's records but the gifter's, and an owner's read never calls it:
 * owners are booking-blind.
 *
 * Best-effort, as the flag is only the card's label: a failed read is logged
 * by its kind (its query holds the gifter's id) and flags nothing, so it never
 * fails the list read or the book it's part of. The next read has it.
 */
export async function itemsGivenBy(
  gifterId: string,
  itemIds: Types.ObjectId[]
): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const mine = { gifter: gifterId, item: { $in: itemIds } };
  try {
    const [given, reserved] = await Promise.all([
      GiftLog.distinct('item', mine),
      Reservation.distinct('item', mine),
    ]);
    const stillReserved = new Set(reserved.map(String));
    return new Set(given.map(String).filter((id) => !stillReserved.has(id)));
  } catch (err) {
    console.error('Reading which booked items were given failed:', errorKind(err));
    return new Set();
  }
}

/**
 * The image a new gift-history entry keeps of the reservation it's made from:
 * the reservation's own, except on a list the gifter can't open (archived
 * included, as `readReservationWishlists` has it), whose card the Booked page
 * shows frozen. There it keeps only what that card shows (`frozenImage`): never
 * the item's own blob, which the owners can still delete or replace, so the
 * gift history can't show their current image once the gift is marked
 * (WIS-359). The blob itself stays: it's the item's.
 *
 * The list is read only for an image that's the item's own blob (a booking from
 * before snapshots, or a failed copy), so marking a gift otherwise reads no
 * list. Read before the entry is written; if the read fails, the entry keeps
 * no image rather than fail the gift (logged by its kind: the query holds the
 * gifter's id).
 */
export async function giftLogImage(
  gifterId: string,
  reservation: Pick<IReservation, 'itemImage' | 'wishlist'>
): Promise<string | null> {
  const image = reservation.itemImage || null;
  if (!image || !isOwnBlob(image) || isSnapshotBlob(image)) return image;
  try {
    const lists = await readReservationWishlists(gifterId, [reservation.wishlist]);
    const list = lists.get(reservation.wishlist.toString());
    return list && !list.archived ? image : null;
  } catch (err) {
    console.error("Reading a gift's list access failed, keeping no image:", errorKind(err));
    return null;
  }
}

/**
 * A gift-history entry as the API returns it: what the entry took when the gift
 * was logged (its image as `giftLogImage` chose it), and its list's id. Nothing
 * in it is read from the live list when it's answered, so
 * building it costs no query, and the gift route's answer needs no read after
 * the gift is logged.
 */
export function serializeGiftLog(
  g: Pick<
    IGiftLog,
    | '_id'
    | 'itemName'
    | 'itemImage'
    | 'itemPrice'
    | 'recipientUsername'
    | 'wishlistName'
    | 'wishlist'
    | 'giftedAt'
  >
) {
  return {
    _id: g._id.toString(),
    itemName: g.itemName,
    itemImage: g.itemImage ?? null,
    itemPrice: g.itemPrice ?? null,
    recipientUsername: g.recipientUsername ?? null,
    wishlistName: g.wishlistName ?? null,
    wishlistId: g.wishlist?.toString() ?? null,
    giftedAt: g.giftedAt,
  };
}
