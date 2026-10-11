import type { Metadata } from 'next';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import ShareLinkUnavailable from '@/components/ShareLinkUnavailable';
import WishlistPage from '@/components/WishlistPage';
import { linkVisitorView, resolveLinkForViewer } from '@/lib/utils/shareLinkPage';

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
 * That same session read also tells when nobody is signed in, the one viewer
 * the server knows is a visitor: their page draws the list's header and the
 * visitor's note on the server (`visitorView`, WIS-447), so its largest text is
 * in the HTML rather than after the scripts and the reads. A request with a
 * session (an owner or member, maybe), or one whose session can't be read, gets
 * the skeleton until the browser knows who's viewing, as before; and the
 * browser drops the visitor's view if it finds a session there (signed in in
 * another tab since). So the view is only ever drawn for a request that
 * carried no session.
 *
 * `?as=visitor` is an owner's Preview as visitor; `?then=ask` / `?then=join` a
 * visitor back from signing in to ask to join, or to join (a Join link, whose
 * confirmation then opens; joining still takes a click).
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
  const resolved = await resolveLinkForViewer(token);

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

  const preview = query.as === 'visitor';
  return (
    <WishlistPage
      address={{
        kind: 'link',
        token,
        listId: String(resolved.wishlist._id),
        // Only a visitor is shown it: Join this list on a Join link (WIS-337).
        level: resolved.link.level,
        preview,
        then: query.then === 'ask' || query.then === 'join' ? query.then : null,
        // Signed out: a visitor for sure. Not an owner's Preview as visitor,
        // which only an owner (signed in) is offered.
        visitorView:
          resolved.signedOut && !preview ? await linkVisitorView(resolved.wishlist) : undefined,
      }}
    />
  );
}
