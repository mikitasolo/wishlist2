import { NextResponse } from 'next/server';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import {
  admitListViewer,
  linkModeAnswer,
  wishlistNotFoundResponse,
} from '@/lib/utils/shareLinkAccess';
import { SHARE_TOKEN_HEADER } from '@/lib/utils/shareLinkFields';

export const wishlistNotFound = wishlistNotFoundResponse;

export type RequesterAccess =
  | { response: NextResponse }
  | {
      response?: undefined;
      wishlist: IWishlist;
      id: string;
      isOwner: boolean;
      isMember: boolean;
      /** Marks a link-mode success `private, no-store`, as its refusals are. */
      answer: <T extends Response>(response: T) => T;
    };

/**
 * The list a would-be requester addresses, read for the requester's own routes
 * (`POST /requests`, `GET` / `DELETE /requests/me`), once the caller is known to
 * be signed in. It admits them through `getWishlistViewAccess`, as a list's own
 * read does, but answers *every* refusal (archived, private, friends-only to a
 * non-friend) with the `Wishlist not found` 404 of a list that doesn't exist:
 * there's nothing to ask on a list you can't open, and asking mustn't confirm
 * that one exists.
 *
 * A request carrying a share link (`X-Share-Token`, WIS-335) is admitted by it
 * through `admitListViewer`: a live link to this list lets them ask whatever
 * the list's visibility, and a dead one is the same 404 (or the failed-lookup
 * 429). Every answer to a link-mode request is `private, no-store`: the route
 * passes its success through `answer`.
 */
export async function readListForRequester(
  request: Request,
  idParam: string,
  userId: string
): Promise<RequesterAccess> {
  const linkMode = request.headers.get(SHARE_TOKEN_HEADER) !== null;
  const refuse = (response: NextResponse = wishlistNotFound()) => ({
    response: linkMode ? linkModeAnswer(response) : response,
  });
  const id = await resolveWishlistId(idParam);
  if (!id) return refuse();
  const wishlist = await Wishlist.findById(id);
  if (!wishlist) return refuse();
  const admission = await admitListViewer(request, wishlist, userId);
  // Every refusal is the missing list's; a link's failed-lookup 429 stays one.
  if (!admission.allowed) {
    return refuse(admission.response.status === 429 ? admission.response : undefined);
  }
  return {
    wishlist,
    id,
    isOwner: admission.isOwner,
    isMember: admission.isMember,
    answer: (response) => (linkMode ? linkModeAnswer(response) : response),
  };
}
