import mongoose from 'mongoose';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { getFriendIds } from '@/lib/utils/friends';
import type { Occasion } from '@/lib/utils/occasion';
import { viewableWishlistsFilter } from '@/lib/utils/wishlistAccess';

type Id = string | mongoose.Types.ObjectId;

/** What the Booked page gets of the live wishlist behind a gifter's reservation. */
export interface ReservationWishlist {
  slug: string | null;
  /**
   * The list's occasion, read live, so an owner changing or clearing it shows
   * on the next read. `null` for a list with none, and for one the gifter may
   * no longer open.
   */
  occasion: Occasion | null;
}

interface StoredOccasion {
  kind: Occasion['kind'];
  date: string;
  recurrence?: Occasion['recurrence'];
}

interface Facets {
  all: { _id: mongoose.Types.ObjectId; slug?: string | null }[];
  viewable: { _id: mongoose.Types.ObjectId; occasion?: StoredOccasion | null }[];
}

/**
 * The live wishlists behind a gifter's reservations, by id, read in a fixed
 * number of queries however many there are: one for the gifter's memberships of
 * them, `getFriendIds` for their friends, and one for the lists themselves.
 * A deleted list has no entry.
 *
 * A Reservation outlives the gifter's access to its list (leave, kick, the list
 * archived or made private: see `models/Reservation.ts`), so a list's occasion
 * is only returned while the gifter may still open it. That's decided by
 * `viewableWishlistsFilter`, the query form of `getWishlistViewAccess`, applied
 * inside the same query. Every list's slug is returned, as before.
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
  // One query for the lists, each one's occasion only where the filter admits
  // the gifter. An aggregation doesn't cast, so every id above is an ObjectId.
  // `$facet` answers with one document, even when no list is left.
  const [{ all, viewable }] = await Wishlist.aggregate<Facets>([
    { $match: { _id: { $in: ids } } },
    {
      $facet: {
        all: [{ $project: { slug: 1 } }],
        viewable: [
          { $match: viewableWishlistsFilter({ id: gifterId, memberOf, friendIds }) },
          { $project: { occasion: 1 } },
        ],
      },
    },
  ]);

  const occasions = new Map(viewable.map((w) => [w._id.toString(), toOccasion(w.occasion)]));
  return new Map(
    all.map((w) => {
      const id = w._id.toString();
      return [id, { slug: w.slug ?? null, occasion: occasions.get(id) ?? null }];
    })
  );
}

/** A stored occasion in the API's shape (a list saved before occasions has none). */
function toOccasion(stored: StoredOccasion | null | undefined): Occasion | null {
  if (!stored) return null;
  return { kind: stored.kind, date: stored.date, recurrence: stored.recurrence ?? null };
}
