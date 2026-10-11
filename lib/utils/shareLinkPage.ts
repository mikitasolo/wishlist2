import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { auth } from '@/lib/auth';
import { checkRateLimit, ipKey } from '@/lib/rateLimit';
import { errorKind } from '@/lib/utils/errorKind';
import { isBlockedFromShareLinks } from '@/lib/utils/linkBlocks';
import { resolveShareLink, type ResolvedShareLink } from '@/lib/utils/shareLinks';
import { ownerIds } from '@/lib/utils/wishlistOwners';
import { getVisibility } from '@/lib/utils/visibility';
import type { LinkVisitorView } from '@/lib/utils/linkVisitorView';
import User from '@/models/User';
import type { IWishlist } from '@/models/Wishlist';

/**
 * A live link, its list, and whether the request came with no session at all
 * (`signedOut`), which the page's kick check (below) read anyway. Only a
 * signed-out viewer is known on the server to be a visitor: anyone signed in
 * may be one of the list's owners or members, whom the browser sends on.
 */
export type ResolvedLinkForViewer = ResolvedShareLink & { signedOut: boolean };

/**
 * The live link `token` opens for whoever is viewing, for a server-rendered
 * page (`/l/[token]`, and `/welcome` on its way back to one, WIS-339); or null.
 * Null alike for a dead link and for a signed-in viewer the list's owners
 * kicked (WIS-338), so a kick can't be told from a revoke. A failed lookup
 * spends the IP's `shareLinkInvalid` budget, as the API's do, so no page is a
 * way to test tokens. A read that fails (the database, say) throws to the
 * error page rather than passing for a dead link.
 */
export async function resolveLinkForViewer(token: string): Promise<ResolvedLinkForViewer | null> {
  const live = await resolveShareLink(token);
  const viewer = live ? await readViewer(live.wishlist._id) : null;
  const resolved =
    live && viewer && !viewer.kicked ? { ...live, signedOut: viewer.signedOut } : null;
  if (!resolved) await checkRateLimit('shareLinkInvalid', ipKey(new Headers(await headers())));
  return resolved;
}

/**
 * Whether the signed-in viewer was kicked from the list (`WishlistLinkBlock`),
 * and whether there was no session at all. Read only for a live link. Nothing
 * about who the viewer is reaches the page: only that nobody is signed in,
 * which lets it draw a visitor's view on the server (WIS-447). A session that
 * can't be read lets the page render, as not known to be signed out; its reads
 * are refused by the same check in `admitListViewer`, which then shows the same
 * dead state.
 */
async function readViewer(
  wishlistId: Parameters<typeof isBlockedFromShareLinks>[0]
): Promise<{ kicked: boolean; signedOut: boolean }> {
  let viewerId: string | undefined;
  try {
    viewerId = (await auth())?.user?.id;
  } catch (error) {
    unstable_rethrow(error);
    console.error('Share link page could not read the session:', errorKind(error));
    return { kicked: false, signedOut: false };
  }
  if (!viewerId) return { kicked: false, signedOut: true };
  return { kicked: await isBlockedFromShareLinks(wishlistId, viewerId), signedOut: false };
}

/**
 * What a signed-out visitor's `/l/<token>` page draws on the server above the
 * items (WIS-447): the list's name, owners, occasion, visibility, banner and
 * description, the same fields the list's own read answers a link visitor, so
 * the page's largest text is in the HTML. Owners are named by their public
 * usernames, in `owners` order, as that read does (never an email).
 */
export async function linkVisitorView(wishlist: IWishlist): Promise<LinkVisitorView> {
  const owners = ownerIds(wishlist);
  const users = await User.find({ _id: { $in: owners } })
    .select('username')
    .lean();
  const usernameById = new Map(users.map((u) => [String(u._id), u.username]));
  const occasion = wishlist.occasion;
  return {
    name: wishlist.name,
    ownerUsernames: owners.map((id) => usernameById.get(id)).filter((u): u is string => !!u),
    ownerCount: owners.length,
    occasion: occasion
      ? { kind: occasion.kind, date: occasion.date, recurrence: occasion.recurrence }
      : null,
    visibility: getVisibility(wishlist),
    bannerUrl: wishlist.bannerUrl || null,
    description: wishlist.description || null,
  };
}
