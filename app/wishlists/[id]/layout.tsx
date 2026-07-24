import type { Metadata } from 'next';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import User from '@/models/User';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';

// Per-wishlist share metadata (og:title/description + twitter card). The
// og:image is supplied separately by opengraph-image.tsx. Only public,
// non-archived lists reveal their name; everything else stays generic so a
// shared link never leaks a private list's title.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  try {
    const { id } = await params;
    await connectDB();
    const wid = await resolveWishlistId(id);
    const w = wid
      ? await Wishlist.findById(wid).select('name owner visibility isPublic archived').lean()
      : null;
    if (w) {
      const isPublic = (w.visibility ? w.visibility === 'everyone' : w.isPublic) && !w.archived;
      if (isPublic) {
        const owner = await User.findById(w.owner).select('username').lean();
        const title = w.name;
        const description = owner?.username
          ? `@${owner.username}’s wishlist on Wishlist`
          : 'A wishlist on Wishlist';
        return {
          title,
          description,
          openGraph: { title, description, type: 'website' },
          twitter: { card: 'summary_large_image', title, description },
        };
      }
    }
  } catch {
    // fall through to the generic default
  }
  return { title: 'Wishlist', description: 'Create and share your wishlist' };
}

export default function WishlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
