import connectDB from '@/lib/mongodb';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';

/**
 * Owner-or-admin access check for a wishlist. Returns the wishlist doc too so
 * callers can reuse it. `wishlist` is undefined only when the id doesn't exist.
 */
export async function getAdminOrOwnerAccess(
  wishlistId: string,
  userId: string
): Promise<{ hasAccess: boolean; wishlist?: IWishlist }> {
  await connectDB();
  const wishlist = await Wishlist.findById(wishlistId);
  if (!wishlist) return { hasAccess: false };
  if (wishlist.owner.toString() === userId) return { hasAccess: true, wishlist };
  const membership = await WishlistMember.findOne({
    wishlist: wishlistId,
    user: userId,
    role: 'admin',
  });
  return { hasAccess: !!membership, wishlist };
}

/** Lightweight boolean variant — only fetches what's needed. */
export async function isAdminOrOwner(wishlistId: string, userId: string): Promise<boolean> {
  await connectDB();
  const wishlist = await Wishlist.findById(wishlistId).select('owner');
  if (!wishlist) return false;
  if (wishlist.owner.toString() === userId) return true;
  const membership = await WishlistMember.findOne({
    wishlist: wishlistId,
    user: userId,
    role: 'admin',
  });
  return !!membership;
}
