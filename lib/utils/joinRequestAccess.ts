import { NextResponse } from 'next/server';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getWishlistViewAccess } from '@/lib/utils/wishlistAccess';

export const wishlistNotFound = () =>
  NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });

export type RequesterAccess =
  | { response: NextResponse }
  | {
      response?: undefined;
      wishlist: IWishlist;
      id: string;
      isOwner: boolean;
      isMember: boolean;
    };

/**
 * The list a would-be requester addresses, read for the requester's own routes
 * (`POST /requests`, `GET` / `DELETE /requests/me`), once the caller is known to
 * be signed in. It admits them through `getWishlistViewAccess`, as a list's own
 * read does, but answers *every* refusal (archived, private, friends-only to a
 * non-friend) with the `Wishlist not found` 404 of a list that doesn't exist:
 * there's nothing to ask on a list you can't open, and asking mustn't confirm
 * that one exists.
 */
export async function readListForRequester(
  idParam: string,
  userId: string
): Promise<RequesterAccess> {
  const id = await resolveWishlistId(idParam);
  if (!id) return { response: wishlistNotFound() };
  const wishlist = await Wishlist.findById(id);
  if (!wishlist) return { response: wishlistNotFound() };
  const access = await getWishlistViewAccess(wishlist, userId);
  if (!access.allowed) return { response: wishlistNotFound() };
  return { wishlist, id, isOwner: access.isOwner, isMember: access.isMember };
}
