import type { Metadata } from 'next';
import { readWishlistCard } from '@/lib/og/data';
import { METADATA_BUDGET_MS, withTimeout } from '@/lib/utils/og';

// Per-wishlist share metadata (og:title/description/url + twitter card). The
// og:image is supplied separately by opengraph-image.tsx. Only a list a
// signed-out visitor may open (public, non-archived) reveals its name;
// everything else stays generic so a shared link never leaks a private list's
// title (lib/og/data.ts).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  try {
    const { id } = await params;
    const card = await withTimeout(readWishlistCard(id), METADATA_BUDGET_MS);
    if (card.kind === 'public') {
      const title = card.name;
      const by = card.ownerUsername ? ` by @${card.ownerUsername}` : '';
      const description = `Browse “${card.name}”${by} on Wishlist and quietly reserve a gift without spoiling the surprise for them.`;
      return {
        title,
        description,
        openGraph: {
          siteName: 'Wishlist',
          title,
          description,
          type: 'website',
          url: `/wishlists/${card.slug ?? card.id}`,
        },
        twitter: { card: 'summary_large_image', title, description },
      };
    }
  } catch {
    // A timeout or failed read falls through to the generic default.
  }
  return {};
}

export default function WishlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
