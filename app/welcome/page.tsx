import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import WelcomeForm, { type WelcomeNextList } from '@/components/WelcomeForm';
import { shareLinkTokenFromCallback } from '@/lib/utils/shareLinkFields';
import { resolveLinkForViewer } from '@/lib/utils/shareLinkPage';
import { errorKind } from '@/lib/utils/errorKind';

/**
 * A new account's first page (`WelcomeForm`). Rendered per request: when the
 * sign-up is headed back to a share link (`callbackUrl` is `/l/<token>` here),
 * a live one names its list, so the person knows the list is one click away
 * (WIS-339). The link is resolved as `/l/[token]` resolves it
 * (`resolveLinkForViewer`): a dead link, or one the viewer was kicked from,
 * names nothing, and the page looks as it does for any other destination;
 * so does a lookup that fails.
 */
export const dynamic = 'force-dynamic';

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { callbackUrl } = await searchParams;
  return <WelcomeForm nextList={await nextListFor(callbackUrl)} />;
}

async function nextListFor(
  callbackUrl: string | string[] | undefined
): Promise<WelcomeNextList | null> {
  if (typeof callbackUrl !== 'string') return null;
  const token = shareLinkTokenFromCallback(callbackUrl, await requestOrigin());
  if (!token) return null;
  try {
    const resolved = await resolveLinkForViewer(token);
    return resolved ? { name: resolved.wishlist.name, level: resolved.link.level } : null;
  } catch (error) {
    // Unlike `/l/[token]`, a failed read here costs only the line naming the
    // list: Auth.js sends a new account here once, so never fail the page.
    unstable_rethrow(error);
    console.error('Welcome could not read the share link:', errorKind(error));
    return null;
  }
}

/** This request's own origin, as the browser sees it, behind a proxy too. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`;
}
