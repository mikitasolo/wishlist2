import type { Types } from 'mongoose';
import Wishlist from '@/models/Wishlist';
import type { IGiftLog } from '@/models/GiftLog';

// Server-side shaping of the gifter's gift history (`GiftLog`), shared by the
// routes that return an entry: `GET /api/users/me/gifts` lists them, and
// `POST /api/reservations/[id]/gift` returns the one it wrote, which the Booked
// page adds to its copy of the list as is. Both must give an entry the same
// shape, so build it only here.

/** Current wishlist slugs, by wishlist id, for linking gift-history entries. */
export type GiftWishlistSlugs = Map<string, string | null>;

/**
 * Looks up the current slug of each wishlist these records point to. The
 * pointer is soft: a deleted wishlist has no row, so its entries get no slug.
 */
export async function giftWishlistSlugs(
  records: { wishlist?: Types.ObjectId | null }[]
): Promise<GiftWishlistSlugs> {
  const ids = Array.from(
    new Set(records.map((r) => r.wishlist?.toString()).filter(Boolean) as string[])
  );
  const wishlists = ids.length ? await Wishlist.find({ _id: { $in: ids } }).select('slug') : [];
  return new Map(wishlists.map((w) => [w._id.toString(), w.slug ?? null]));
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
