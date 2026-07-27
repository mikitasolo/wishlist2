import connectDB from '@/lib/mongodb';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';

/**
 * Management access to a wishlist: owners only. There's no middle tier — anyone
 * trusted to manage a list is a co-owner of it (see `models/WishlistMember.ts`).
 *
 * Returns the wishlist doc too so callers can reuse it. `wishlist` is undefined
 * only when the id doesn't exist.
 */
export async function getOwnerAccess(
  wishlistId: string,
  userId: string
): Promise<{ isOwner: boolean; wishlist?: IWishlist }> {
  await connectDB();
  const wishlist = await Wishlist.findById(wishlistId);
  if (!wishlist) return { isOwner: false };
  return { isOwner: isWishlistOwner(wishlist, userId), wishlist };
}

/** Lightweight boolean variant — only fetches what's needed. */
export async function isOwnerOfWishlist(wishlistId: string, userId: string): Promise<boolean> {
  await connectDB();
  const wishlist = await Wishlist.findById(wishlistId).select('owners owner');
  return !!wishlist && isWishlistOwner(wishlist, userId);
}
