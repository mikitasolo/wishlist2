import mongoose from 'mongoose';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { getFriendIds } from '@/lib/utils/friends';
import type { Occasion } from '@/lib/utils/occasion';
import { isHiddenByArchive, viewableUnlessArchivedFilter } from '@/lib/utils/wishlistAccess';

type Id = string | mongoose.Types.ObjectId;

/**
 * What the Booked page gets of the live wishlist behind one of a gifter's
 * reservations: what it says now, while the gifter may still open it, or only
 * that it's archived, while its archiving hides it from them.
 */
export type ReservationWishlist = OpenReservationWishlist | { archived: true };

/** A list the gifter may still open, as the Booked page reads it. */
export interface OpenReservationWishlist {
  archived: false;
  /** The list's current slug, which the card links it by (`null` if it has none). */
  slug: string | null;
  /**
   * The list's occasion, read live, so an owner changing or clearing it shows
   * on the next read. `null` for a list with none.
   */
  occasion: Occasion | null;
}

interface StoredOccasion {
  kind: Occasion['kind'];
  date: string;
  recurrence?: Occasion['recurrence'];
}

interface StoredWishlist {
  _id: mongoose.Types.ObjectId;
  owners: mongoose.Types.ObjectId[];
  archived?: boolean;
  slug?: string | null;
  occasion?: StoredOccasion | null;
}

/**
 * The live wishlists behind a gifter's reservations, by id, read in a fixed
 * number of queries however many there are: one for the gifter's memberships
 * of them, `getFriendIds` for their friends, and one for the lists themselves.
 *
 * A Reservation outlives the gifter's access to its list (leave, kick, the
 * list archived or made private: see `models/Reservation.ts`), so a list is
 * only returned in full while the gifter may still open it, by the rules of
 * `viewableWishlistsFilter`, the query form of `getWishlistViewAccess`, applied
 * inside that one query. A list they may not open has no entry, as a deleted
 * one has none, so nothing it says now reaches them: not its occasion, and not
 * its slug, which an owner can change, and which is made from its name.
 * Without one the card names the list as the reservation's snapshot has it,
 * unlinked, as no longer available to them.
 *
 * Except a list that only its archiving hides from them (owner-only:
 * `isHiddenByArchive`), which they could open otherwise (WIS-124): its entry
 * says only that it's archived, and the reservation is shown frozen, as its
 * snapshot alone, marked as on an archived list, with nothing live of the list
 * or of its item. Once it's unarchived it's back in full. One the gifter
 * couldn't open anyway (they were kicked from it, say) has no entry, archived
 * or not, so they can't tell its archiving, or its unarchiving, from anything
 * else. An owner is never hidden from their own list, archived or not.
 */
export async function readReservationWishlists(
  gifterId: string,
  wishlistIds: Id[]
): Promise<Map<string, ReservationWishlist>> {
  const ids = Array.from(new Set(wishlistIds.map(String))).map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  if (ids.length === 0) return new Map();

  const gifter = new mongoose.Types.ObjectId(gifterId);
  const [memberOf, friendIds] = await Promise.all([
    WishlistMember.distinct('wishlist', { user: gifter, wishlist: { $in: ids } }),
    getFriendIds(gifter),
  ]);
  // The lists they may open, or could but for their archiving: that is,
  // `viewableWishlistsFilter` without its archived clause, which is applied
  // below instead (`isHiddenByArchive`).
  const lists = await Wishlist.find({
    $and: [
      { _id: { $in: ids } },
      viewableUnlessArchivedFilter({ id: gifterId, memberOf, friendIds }),
    ],
  })
    .select('slug occasion archived owners')
    .lean<StoredWishlist[]>();

  return new Map(
    lists.map((w): [string, ReservationWishlist] => [
      w._id.toString(),
      isHiddenByArchive(w, gifterId)
        ? { archived: true }
        : { archived: false, slug: w.slug ?? null, occasion: toOccasion(w.occasion) },
    ])
  );
}

/** A stored occasion in the API's shape (a list saved before occasions has none). */
function toOccasion(stored: StoredOccasion | null | undefined): Occasion | null {
  if (!stored) return null;
  return { kind: stored.kind, date: stored.date, recurrence: stored.recurrence ?? null };
}
