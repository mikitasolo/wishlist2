import type { Metadata } from 'next';
import { readShareLinkCard } from '@/lib/og/data';
import { METADATA_BUDGET_MS, withTimeout } from '@/lib/utils/og';

// A share link's preview metadata (WIS-336); its og:image is
// opengraph-image.tsx. A live link names its list whatever the list's
// visibility, since the owner chose to share the link; a dead one gets the
// generic default, exactly like a missing list. og:url is the link itself: the
// list's own URL wouldn't open for the chat's readers. The page's own metadata
// (no indexing, same-origin referrer) is merged over this.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  try {
    const { token } = await params;
    const card = await withTimeout(readShareLinkCard(token), METADATA_BUDGET_MS);
    if (card.kind === 'public') {
      const title = card.name;
      const by = card.ownerUsername ? ` by @${card.ownerUsername}` : '';
      const description = `Browse “${card.name}”${by} on Wishlist.`;
      return {
        title,
        description,
        openGraph: {
          siteName: 'Wishlist',
          title,
          description,
          type: 'website',
          url: `/l/${token}`,
        },
        twitter: { card: 'summary_large_image', title, description },
      };
    }
  } catch {
    // A timeout or failed read falls through to the generic default.
  }
  return {};
}

export default function ShareLinkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
