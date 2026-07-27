import { ImageResponse } from 'next/og';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import Item from '@/models/Item';
import User from '@/models/User';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { ogGradient, withTimeout } from '@/lib/utils/og';
import { primaryOwnerId } from '@/lib/utils/wishlistOwners';

// Runs on the Node runtime (default) because it touches Mongoose.
export const alt = 'Wishlist';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Bound all data work so a slow DB can never make the crawler-facing image time
// out into a 500.
const DATA_BUDGET_MS = 4000;

interface CardData {
  title: string;
  subtitle: string;
  seed: string;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id: idOrSlug } = await params;

  // Privacy: crawlers are unauthenticated, so only public, non-archived lists
  // reveal their name / owner / item count. Everything else gets a generic card.
  let data: CardData = { title: 'A wishlist', subtitle: 'on Wishlist', seed: idOrSlug };

  async function gather(): Promise<CardData> {
    await connectDB();
    const wid = await resolveWishlistId(idOrSlug);
    const w = wid
      ? await Wishlist.findById(wid).select('name owners visibility isPublic archived').lean()
      : null;
    if (!w) return data;
    const seed = w._id.toString();
    const isPublic = (w.visibility ? w.visibility === 'everyone' : w.isPublic) && !w.archived;
    if (!isPublic) return { ...data, seed, title: 'A private wishlist' };
    const [owner, count] = await Promise.all([
      // Co-owned lists are credited to their primary owner on the share card.
      User.findById(primaryOwnerId(w)).select('username').lean(),
      Item.countDocuments({ wishlist: w._id, status: { $nin: ['draft', 'proposed'] } }),
    ]);
    const items = `${count} item${count === 1 ? '' : 's'}`;
    return {
      seed,
      title: w.name,
      subtitle: owner?.username ? `@${owner.username}’s wishlist · ${items}` : items,
    };
  }

  try {
    data = await withTimeout(gather(), DATA_BUDGET_MS);
  } catch {
    // Timeout or lookup failure → fast generic card.
  }

  const g = ogGradient(data.seed);

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
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05 }}>{data.title}</div>
        <div style={{ fontSize: 36, opacity: 0.9 }}>{data.subtitle}</div>
      </div>
    </div>,
    { ...size }
  );
}
