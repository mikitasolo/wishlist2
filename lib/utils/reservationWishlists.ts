import mongoose from 'mongoose';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { getFriendIds } from '@/lib/utils/friends';
import type { Occasion } from '@/lib/utils/occasion';
import { viewableWishlistsFilter } from '@/lib/utils/wishlistAccess';

type Id = string | mongoose.Types.ObjectId;

/**
 * What the Booked page gets of the live wishlist behind one of a gifter's
 * reservations or gift-history entries, while the gifter may still open it.
 */
export interface ReservationWishlist {
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
  slug?: string | null;
  occasion?: StoredOccasion | null;
}

/**
 * The live wishlists behind a gifter's reservations, or their gift-history
 * entries (`giftWishlistSlugs`), by id, read in a fixed number of queries
 * however many there are: one for the gifter's memberships of them,
 * `getFriendIds` for their friends, and one for the lists themselves.
 *
 * A Reservation and a GiftLog outlive the gifter's access to their list (leave,
 * kick, the list archived or made private: see `models/Reservation.ts`), so a
 * list is only returned while the gifter may still open it. That's decided by
 * `viewableWishlistsFilter`, the query form of `getWishlistViewAccess`, applied
 * inside that one query. A list they may no longer open has no entry, as a
 * deleted one has none, so nothing it says now reaches them: not its occasion,
 * and not its slug, which an owner can change, and which is made from its name.
 * A reservation's card links the list by id instead, which answers them as it
 * would any other outsider.
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
  const lists = await Wishlist.find({
    $and: [{ _id: { $in: ids } }, viewableWishlistsFilter({ id: gifterId, memberOf, friendIds })],
  })
    .select('slug occasion')
    .lean<StoredWishlist[]>();

  return new Map(
    lists.map((w) => [w._id.toString(), { slug: w.slug ?? null, occasion: toOccasion(w.occasion) }])
  );
}

/** A stored occasion in the API's shape (a list saved before occasions has none). */
function toOccasion(stored: StoredOccasion | null | undefined): Occasion | null {
  if (!stored) return null;
  return { kind: stored.kind, date: stored.date, recurrence: stored.recurrence ?? null };
}
