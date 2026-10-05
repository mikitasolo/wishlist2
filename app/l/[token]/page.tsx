import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { auth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import ShareLinkUnavailable from '@/components/ShareLinkUnavailable';
import WishlistPage from '@/components/WishlistPage';
import { resolveShareLink } from '@/lib/utils/shareLinks';
import { checkRateLimit, ipKey } from '@/lib/rateLimit';
import { isBlockedFromShareLinks } from '@/lib/utils/linkBlocks';
import { errorKind } from '@/lib/utils/errorKind';

/**
 * A list opened through its share link, `/l/<token>` (WIS-335). Rendered per
 * request, never cached: the link may be revoked or expire at any moment.
 *
 * The token is resolved here once (`resolveShareLink`, which checks its shape
 * before any query) only to find the list's id for the page's own reads, which
 * send the token again in `X-Share-Token` and are admitted by it. A dead link
 * (malformed, unknown, revoked, expired, its list archived or gone) gets the
 * one dead state, for every viewer; a failed lookup spends the IP's
 * `shareLinkInvalid` budget, as the API's do. Who's viewing is only known in
 * the browser (only the home page reads the session on the server), so owners
 * and members are sent on to the list's own URL from there. The one exception:
 * someone signed in whom the list's owners kicked (WIS-338) gets the dead state
 * here too, as the API answers them, so a kick can't be told from a revoke.
 *
 * `?as=visitor` is an owner's Preview as visitor; `?then=ask` a visitor back
 * from signing in to ask to join.
 */
export const dynamic = 'force-dynamic';

// The preview's metadata is layout.tsx's (WIS-336). No indexing of a secret URL;
// and nothing the page links out to is told the token-bearing URL.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'same-origin',
};

export default async function ShareLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const resolved = await resolveLink(token);

  if (!resolved) {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <ShareLinkUnavailable />
        </main>
      </div>
    );
  }

  return (
    <WishlistPage
      address={{
        kind: 'link',
        token,
        listId: String(resolved.wishlist._id),
        preview: query.as === 'visitor',
        then: query.then === 'ask' ? 'ask' : null,
      }}
    />
  );
}

/**
 * The live link `token` opens, or null; a failed lookup spends the IP's budget.
 * A read that fails (the database, say) throws to the error page rather than
 * passing for a dead link.
 */
async function resolveLink(token: string) {
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
