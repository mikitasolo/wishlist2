import type { Metadata } from 'next';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import User from '@/models/User';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { primaryOwnerId } from '@/lib/utils/wishlistOwners';

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
      ? await Wishlist.findById(wid).select('name owners visibility isPublic archived').lean()
      : null;
    if (w) {
      const isPublic = (w.visibility ? w.visibility === 'everyone' : w.isPublic) && !w.archived;
      if (isPublic) {
        // A co-owned list is credited to its primary owner in share metadata.
        const owner = await User.findById(primaryOwnerId(w)).select('username').lean();
        const title = w.name;
        const by = owner?.username ? ` by @${owner.username}` : '';
        const description = `Browse “${w.name}”${by} on Wishlist and quietly reserve a gift without spoiling the surprise for them.`;
        return {
          title,
          description,
          openGraph: { siteName: 'Wishlist', title, description, type: 'website' },
          twitter: { card: 'summary_large_image', title, description },
        };
      }
    }
  } catch {
    // fall through to the generic default
  }
  return {};
}

export default function WishlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
