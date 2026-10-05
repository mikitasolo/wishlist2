import type { Metadata } from 'next';
import { headers } from 'next/headers';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import ShareLinkUnavailable from '@/components/ShareLinkUnavailable';
import WishlistPage from '@/components/WishlistPage';
import { resolveShareLink } from '@/lib/utils/shareLinks';
import { checkRateLimit, ipKey } from '@/lib/rateLimit';

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
 * and members are sent on to the list's own URL from there.
 *
 * `?as=visitor` is an owner's Preview as visitor; `?then=ask` a visitor back
 * from signing in to ask to join.
 */
export const dynamic = 'force-dynamic';

// No preview of the list here yet (WIS-336), nor any indexing of a secret URL;
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
  const resolved = await resolveShareLink(token);
  if (!resolved) await checkRateLimit('shareLinkInvalid', ipKey(new Headers(await headers())));
  return resolved;
}
