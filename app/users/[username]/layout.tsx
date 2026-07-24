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
      const title = `@${u.username} on Wishlist`;
      const bioVisible = u.privacy?.profileVisibility !== 'friends';
      const description = bioVisible && u.bio ? u.bio : `See @${u.username}’s wishlists.`;
      return {
        title,
        description,
        openGraph: { title, description, type: 'profile' },
        twitter: { card: 'summary_large_image', title, description },
      };
    }
  } catch {
    // fall through
  }
  return { title: 'Wishlist', description: 'Create and share your wishlist' };
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
