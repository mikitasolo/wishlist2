import { NextResponse } from 'next/server';
import { enforce, ipKey } from '@/lib/rateLimit';
import type { IWishlist } from '@/models/Wishlist';
import type { IShareLink } from '@/models/ShareLink';
import { resolveShareLink } from '@/lib/utils/shareLinks';
import { SHARE_TOKEN_HEADER } from '@/lib/utils/shareLinkFields';
import { getWishlistViewAccess } from '@/lib/utils/wishlistAccess';
import { errorKind } from '@/lib/utils/errorKind';
import { isBlockedFromShareLinks } from '@/lib/utils/linkBlocks';

/**
 * Letting a viewer into a list, with or without a share link (WIS-335): the
 * one path the list `GET`, the items `GET`, the join-request routes
 * (`readListForRequester`) and the link join (`POST /join`, WIS-337) take. Everything else calls `getWishlistViewAccess`
 * with no link and stays link-blind.
 *
 * A request that carries no `X-Share-Token` header is admitted exactly as
 * before. One that does is in **link mode**: the header is checked for a
 * token's shape before any query (`resolveShareLink`), resolved once, and the
 * resolved link passed to `getWishlistViewAccess`, which admits only through a
 * live link to *this* list. A dead link (malformed, unknown, revoked, expired,
 * archived list, or another list's token) is dead for everyone, the list's
 * owners included and on a Public list too: every refusal in link mode is the
 * `Wishlist not found` 404. Link-mode answers are `private, no-store`.
 *
 * Only failed lookups are rate-limited, per IP (`shareLinkInvalid`,
 * fail-open), so guessing tokens is slow while a live link, which a whole
 * wedding may open from one IP every 5 seconds, is never throttled.
 *
 * Link resolution lives here alone, so a check on the link covers every
 * route: a signed-in viewer kicked from the list (`WishlistLinkBlock`, WIS-338)
 * is answered exactly as a dead link, failed-lookup budget included.
 */

export const wishlistNotFoundResponse = () =>
  NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });

/** The `Cache-Control` of every answer to a link-mode request. */
export const LINK_MODE_CACHE_CONTROL = 'private, no-store';

export type ListAdmission =
  | { allowed: false; response: NextResponse }
  | {
      allowed: true;
      isOwner: boolean;
      isMember: boolean;
      /** The request came with a share link (a live one, since it was let in). */
      linkMode: boolean;
      /** That link, resolved (in link mode only): the join route reads its level. */
      link?: IShareLink;
    };

/**
 * The share link a link-mode request names, if it's live, opens `wishlist`
 * and `viewerId` isn't kept out of it (kicked, WIS-338), else the dead-link
 * answer. A failed lookup spends the caller's IP budget; over it, the 429 is
 * returned instead.
 */
async function resolveLinkFor(
  token: string,
  wishlist: Pick<IWishlist, '_id'>,
  viewerId: string | null | undefined,
  headers: Headers
): Promise<{ link: IShareLink } | { response: NextResponse }> {
  let resolved: Awaited<ReturnType<typeof resolveShareLink>>;
  try {
    resolved = await resolveShareLink(token);
  } catch (err) {
    // The routes log what they catch; this one never quotes the token.
    throw new Error(`Share link lookup failed: ${JSON.stringify(errorKind(err))}`);
  }
  if (
    resolved &&
    resolved.link.wishlist.equals(wishlist._id) &&
    !(await isBlockedFromShareLinks(wishlist._id, viewerId))
  ) {
    return { link: resolved.link };
  }
  const limited = await enforce('shareLinkInvalid', ipKey(headers));
  return { response: limited ?? wishlistNotFoundResponse() };
}

/**
 * Whether the viewer may open `wishlist`, by the request's share link if it
 * names one (see the module comment), else by `getWishlistViewAccess` alone.
 * Refusals come as the response to send: in link mode always the 404 (or the
 * failed-lookup 429), otherwise the status `getWishlistViewAccess` chose.
 */
export async function admitListViewer(
  request: Request,
  wishlist: Pick<IWishlist, '_id' | 'owners' | 'visibility' | 'archived'>,
  viewerId: string | null | undefined
): Promise<ListAdmission> {
  const token = request.headers.get(SHARE_TOKEN_HEADER);
  if (token === null) {
    const access = await getWishlistViewAccess(wishlist, viewerId);
    if (!access.allowed) {
      return {
        allowed: false,
        response: NextResponse.json(
          { success: false, error: access.error },
          { status: access.status }
        ),
      };
    }
    return { allowed: true, isOwner: access.isOwner, isMember: access.isMember, linkMode: false };
  }

  const resolved = await resolveLinkFor(token, wishlist, viewerId, request.headers);
  if ('response' in resolved)
    return { allowed: false, response: linkModeAnswer(resolved.response) };
  const access = await getWishlistViewAccess(wishlist, viewerId, { link: resolved.link });
  if (!access.allowed) {
    return { allowed: false, response: linkModeAnswer(wishlistNotFoundResponse()) };
  }
  return {
    allowed: true,
    isOwner: access.isOwner,
    isMember: access.isMember,
    linkMode: true,
    link: resolved.link,
  };
}

/** `response` marked `private, no-store`, as every link-mode answer is. */
export function linkModeAnswer<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', LINK_MODE_CACHE_CONTROL);
  return response;
}
