import type mongoose from 'mongoose';
import Item from '@/models/Item';
import {
  readReservationWishlists,
  type OpenReservationWishlist,
} from '@/lib/utils/reservationWishlists';
import { isHttpUrl } from '@/lib/utils/itemFields';
import type { ReservationStatusInfo } from '@/lib/utils/reservations';
import { readGroupGiftSummariesOrThrow } from '@/lib/utils/groupGifts';
import type { ContributingGroupGift } from '@/lib/utils/groupGiftSummary';

/** What a reservation records of where it was made: its item and its list. */
interface ReservationRef {
  item: mongoose.Types.ObjectId;
  wishlist: mongoose.Types.ObjectId;
}

/** A reservation's live state: its status for the Booked page, and its list while open to the gifter. */
export interface ReservationLiveState extends ReservationStatusInfo {
  /** The list as the gifter may still see it, or `null` (gone, hidden from them, or archived). */
  wishlist: OpenReservationWishlist | null;
  /**
   * The live item's product link (http(s) only) and notes, while it's still
   * booked by the gifter on a list they may open, where they can read both on
   * the list anyway. Otherwise `null`: once it isn't theirs, or the list isn't
   * open to them (archived included), nothing more of the item reaches them.
   */
  itemLink: string | null;
  itemNotes: string | null;
  /**
   * The live group gift the gifter is in on this item (WIS-361/363): its
   * target, progress and contributors, as their own read of the list shows it.
   * Only while it's still theirs on a list they may open, like `itemLink`;
   * otherwise `null`, and a reservation they still hold for a gift they're no
   * longer in (or on a list they can't open) says nothing of it.
   */
  groupGift: ContributingGroupGift | null;
}

/**
 * The live state behind each of a gifter's reservations: what has become of
 * its item, and whether they may still open its list. Read in a fixed number
 * of queries however many reservations there are: one for the live items, and
 * `readReservationWishlists` for the lists. Returns a function that answers
 * for one of the reservations it was given.
 *
 * The Booked page's list (`GET /api/users/me/reservations`) and the
 * dashboard's count of the ones that changed (`GET /api/users/me/reservations/
 * summary`) both read through this, and both judge a reservation with
 * `needsConfirmation`, so the two can never disagree about which need the
 * gifter's confirmation.
 *
 * A reservation on a list the gifter can't open is frozen, whatever the
 * reason: archived (WIS-124, which says so with `listArchived` when that's all
 * that hides it), or out of their reach otherwise (they left or were kicked,
 * it was made private, a friendship ended, it was deleted: WIS-295). Nothing
 * of what its owners have done to the item since reaches the gifter, so its
 * `itemStatus` and `stillReserved` are `null`.
 *
 * A group gift's item is booked by its organizer alone, so it's still reserved
 * by each of its contributors too, while they're in the live gift (WIS-363).
 * Its summary is read only for items on lists the gifter may open, and a failed
 * read fails the whole read: without it a contributor's card would read as
 * released.
 */
export async function readReservationLiveState(
  gifterId: string,
  reservations: readonly ReservationRef[]
): Promise<(reservation: ReservationRef) => ReservationLiveState> {
  const [items, wishlists] = await Promise.all([
    reservations.length === 0
      ? []
      : Item.find({ _id: { $in: reservations.map((r) => r.item) } })
          .select('status bookedBy link notes groupGift')
          .lean(),
    readReservationWishlists(
      gifterId,
      reservations.map((r) => r.wishlist)
    ),
  ]);
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));
  // Only items reserved on a list open to the gifter: a frozen card says
  // nothing live.
  const onOpenLists = new Set(
    reservations.flatMap((r) => {
      const entry = wishlists.get(r.wishlist.toString());
      return entry && !entry.archived ? [r.item.toString()] : [];
    })
  );
  const giftSummaries = await readGroupGiftSummariesOrThrow(
    gifterId,
    items.filter((i) => i.groupGift && onOpenLists.has(i._id.toString()))
  );

  return (r) => {
    const it = itemMap.get(r.item.toString());
    const entry = wishlists.get(r.wishlist.toString());
    const listArchived = !!entry?.archived;
    const wishlist = entry && !entry.archived ? entry : null;
    // Frozen once the list isn't open to the gifter, for whatever reason
    // (WIS-124, WIS-295): nothing of what its owners have done to the item
    // since reaches them.
    const summary = wishlist && it ? giftSummaries.get(it._id.toString()) : undefined;
    const groupGift = summary?.contributing ? summary : null;
    const stillReserved = wishlist
      ? !!it &&
        it.status === 'booked' &&
        (groupGift !== null || (!it.groupGift && it.bookedBy?.toString() === gifterId))
      : null;
    // Live details only for a card that's still active: theirs, on a list they can open.
    const live = stillReserved ? it : null;
    return {
      itemStatus: wishlist ? (it ? it.status : 'deleted') : null,
      stillReserved,
      // Whether the gifter may still open the list: `readReservationWishlists`
      // has it (`viewableWishlistsFilter`'s rules). Only their own access, never
      // why they've lost it, except a list only its archiving hides from them,
      // which says so (`listArchived`).
      listOpen: !!wishlist,
      listArchived,
      wishlist,
      itemLink: live?.link && isHttpUrl(live.link) ? live.link : null,
      itemNotes: live?.notes?.trim() ? live.notes : null,
      groupGift: stillReserved ? groupGift : null,
    };
  };
}
