import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { auth } from '@/lib/auth';
import { checkRateLimit, ipKey } from '@/lib/rateLimit';
import { errorKind } from '@/lib/utils/errorKind';
import { isBlockedFromShareLinks } from '@/lib/utils/linkBlocks';
import { resolveShareLink, type ResolvedShareLink } from '@/lib/utils/shareLinks';

/**
 * The live link `token` opens for whoever is viewing, for a server-rendered
 * page (`/l/[token]`, and `/welcome` on its way back to one, WIS-339); or null.
 * Null alike for a dead link and for a signed-in viewer the list's owners
 * kicked (WIS-338), so a kick can't be told from a revoke. A failed lookup
 * spends the IP's `shareLinkInvalid` budget, as the API's do, so no page is a
 * way to test tokens. A read that fails (the database, say) throws to the
 * error page rather than passing for a dead link.
 */
export async function resolveLinkForViewer(token: string): Promise<ResolvedShareLink | null> {
  const live = await resolveShareLink(token);
  const resolved = live && !(await isKickedViewer(live.wishlist._id)) ? live : null;
  if (!resolved) await checkRateLimit('shareLinkInvalid', ipKey(new Headers(await headers())));
  return resolved;
}

/**
 * Whether the signed-in viewer was kicked from the list (`WishlistLinkBlock`).
 * Read only for a live link, and only for this: nothing about the session
 * reaches the page. A session that can't be read lets the page render; its
 * reads are refused by the same check in `admitListViewer`, which then shows
 * the same dead state.
 */
async function isKickedViewer(
  wishlistId: Parameters<typeof isBlockedFromShareLinks>[0]
): Promise<boolean> {
  let viewerId: string | undefined;
  try {
    viewerId = (await auth())?.user?.id;
  } catch (error) {
    unstable_rethrow(error);
    console.error('Share link page could not read the session:', errorKind(error));
    return false;
  }
  return isBlockedFromShareLinks(wishlistId, viewerId);
}
