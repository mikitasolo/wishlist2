import type { Metadata } from 'next';
import { readProfileCard } from '@/lib/og/data';
import { METADATA_BUDGET_MS, withTimeout } from '@/lib/utils/og';

// Per-profile share metadata. Username is always public; the bio is only used
// when the profile isn't friends-only (crawlers are never friends).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  try {
    const { username } = await params;
    const card = await withTimeout(readProfileCard(username), METADATA_BUDGET_MS);
    if (card.kind === 'user') {
      const title = `@${card.username}`;
      // Prefer the bio when it's public and substantial; otherwise a sensible
      // branded default that still reads well as a share/SERP snippet.
      const description =
        card.bio && card.bio.length >= 20
          ? card.bio
          : `See @${card.username}’s wishlists on Wishlist and follow along to reserve gifts without spoiling the surprise.`;
      return {
        title,
        description,
        openGraph: {
          siteName: 'Wishlist',
          title: `@${card.username} on Wishlist`,
          description,
          type: 'profile',
          url: `/users/${card.username}`,
        },
        twitter: {
          card: 'summary_large_image',
          title: `@${card.username} on Wishlist`,
          description,
        },
      };
    }
  } catch {
    // A timeout or failed read falls through to the generic default.
  }
  return {};
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
