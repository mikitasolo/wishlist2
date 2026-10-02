import type { Types } from 'mongoose';
import type { IGiftLog } from '@/models/GiftLog';
import { readReservationWishlists } from '@/lib/utils/reservationWishlists';

// Server-side shaping of the gifter's gift history (`GiftLog`), shared by the
// routes that return an entry: `GET /api/users/me/gifts` lists them, and
// `POST /api/reservations/[id]/gift` returns the one it wrote, which the Booked
// page adds to its copy of the list as is. Both must give an entry the same
// shape, so build it only here.

/** Current wishlist slugs, by wishlist id, for linking gift-history entries. */
export type GiftWishlistSlugs = Map<string, string | null>;

/**
 * The current slug of each wishlist these entries of `gifterId`'s history point
 * to, read the way the Booked page's reservations read theirs
 * (`readReservationWishlists`): in a fixed number of queries, and only for a
 * list the gifter may still open. The pointer is soft and an entry outlives
 * the gifter's access, so a list that's been deleted, or that they may no
 * longer open, has no slug here (its entry still has the list's id).
 */
export async function giftWishlistSlugs(
  gifterId: string,
  records: { wishlist?: Types.ObjectId | null }[]
): Promise<GiftWishlistSlugs> {
  const wishlists = await readReservationWishlists(
    gifterId,
    records.flatMap((r) => (r.wishlist ? [r.wishlist] : []))
  );
  return new Map(Array.from(wishlists, ([id, w]) => [id, w.slug]));
}

/** A gift-history entry as the API returns it. */
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
  >,
  slugs: GiftWishlistSlugs
) {
  return {
    _id: g._id.toString(),
    itemName: g.itemName,
    itemImage: g.itemImage ?? null,
    itemPrice: g.itemPrice ?? null,
    recipientUsername: g.recipientUsername ?? null,
    wishlistName: g.wishlistName ?? null,
    wishlistId: g.wishlist?.toString() ?? null,
    wishlistSlug: g.wishlist ? (slugs.get(g.wishlist.toString()) ?? null) : null,
    giftedAt: g.giftedAt,
  };
}
