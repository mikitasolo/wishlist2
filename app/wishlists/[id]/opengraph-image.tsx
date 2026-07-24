import { ImageResponse } from 'next/og';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import Item from '@/models/Item';
import User from '@/models/User';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { ogGradient } from '@/lib/utils/og';

// Runs on the Node runtime (default) because it touches Mongoose.
export const alt = 'Wishlist';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id: idOrSlug } = await params;

  // Privacy: crawlers are unauthenticated, so only public, non-archived lists
  // reveal their name / owner / item count. Everything else gets a generic card.
  let title = 'A wishlist';
  let subtitle = 'on Wishlist';
  let seed = idOrSlug;

  try {
    await connectDB();
    const wid = await resolveWishlistId(idOrSlug);
    const w = wid
      ? await Wishlist.findById(wid).select('name owner visibility isPublic archived').lean()
      : null;
    if (w) {
      seed = w._id.toString();
      const isPublic = (w.visibility ? w.visibility === 'everyone' : w.isPublic) && !w.archived;
      if (isPublic) {
        const [owner, count] = await Promise.all([
          User.findById(w.owner).select('username').lean(),
          Item.countDocuments({ wishlist: w._id, status: { $nin: ['draft', 'proposed'] } }),
        ]);
        title = w.name;
        const items = `${count} item${count === 1 ? '' : 's'}`;
        subtitle = owner?.username ? `@${owner.username}’s wishlist · ${items}` : items;
      } else {
        title = 'A private wishlist';
      }
    }
  } catch {
    // Fall back to the generic card on any lookup failure.
  }

  const g = ogGradient(seed);

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: 80,
        backgroundImage: g.css,
        color: 'white',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 34, fontWeight: 700 }}
      >
        <div
          style={{
            display: 'flex',
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'rgba(255,255,255,0.9)',
          }}
        />
        Wishlist
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05 }}>{title}</div>
        <div style={{ fontSize: 36, opacity: 0.9 }}>{subtitle}</div>
      </div>
    </div>,
    { ...size }
  );
}
