import type { Metadata } from 'next';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

// Per-profile share metadata. Username is always public; the bio is only used
// when the profile isn't friends-only (crawlers are never friends).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  try {
    const { username } = await params;
    await connectDB();
    const u = await User.findOne({ username }).select('username bio privacy').lean();
    if (u) {
      const title = `@${u.username}`;
      const bioVisible = u.privacy?.profileVisibility !== 'friends';
      // Prefer the bio when it's public and substantial; otherwise a sensible
      // branded default that still reads well as a share/SERP snippet.
      const description =
        bioVisible && u.bio && u.bio.trim().length >= 20
          ? u.bio.trim()
          : `See @${u.username}’s wishlists on Wishlist and follow along to reserve gifts without spoiling the surprise.`;
      return {
        title,
        description,
        openGraph: {
          siteName: 'Wishlist',
          title: `@${u.username} on Wishlist`,
          description,
          type: 'profile',
        },
        twitter: { card: 'summary_large_image', title: `@${u.username} on Wishlist`, description },
      };
    }
  } catch {
    // fall through
  }
  return {};
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
