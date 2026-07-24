import { ImageResponse } from 'next/og';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import Item from '@/models/Item';
import User from '@/models/User';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { ogGradient, fetchImageDataUri, withTimeout } from '@/lib/utils/og';

// Runs on the Node runtime (default) because it touches Mongoose.
export const alt = 'Wishlist';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Bound all data work so a slow DB/image can never make the crawler-facing
// image time out into a 500.
const DATA_BUDGET_MS = 4000;

interface CardData {
  title: string;
  subtitle: string;
  seed: string;
  cover: string | null;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id: idOrSlug } = await params;

  // Privacy: crawlers are unauthenticated, so only public, non-archived lists
  // reveal their name / owner / item count / cover. Everything else gets a
  // generic card.
  let data: CardData = {
    title: 'A wishlist',
    subtitle: 'on Wishlist',
    seed: idOrSlug,
    cover: null,
  };

  async function gather(): Promise<CardData> {
    await connectDB();
    const wid = await resolveWishlistId(idOrSlug);
    const w = wid
      ? await Wishlist.findById(wid)
          .select('name owner visibility isPublic archived bannerUrl')
          .lean()
      : null;
    if (!w) return data;
    const seed = w._id.toString();
    const isPublic = (w.visibility ? w.visibility === 'everyone' : w.isPublic) && !w.archived;
    if (!isPublic) return { ...data, seed, title: 'A private wishlist' };
    const [owner, count, cover] = await Promise.all([
      User.findById(w.owner).select('username').lean(),
      Item.countDocuments({ wishlist: w._id, status: { $nin: ['draft', 'proposed'] } }),
      fetchImageDataUri(w.bannerUrl),
    ]);
    const items = `${count} item${count === 1 ? '' : 's'}`;
    return {
      seed,
      title: w.name,
      subtitle: owner?.username ? `@${owner.username}’s wishlist · ${items}` : items,
      cover,
    };
  }

  try {
    data = await withTimeout(gather(), DATA_BUDGET_MS);
  } catch {
    // Timeout or lookup failure → fast generic card.
  }

  const { title, subtitle, cover } = data;
  const g = ogGradient(data.seed);

  const Brand = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 34, fontWeight: 700 }}>
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
  );

  const Text = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05 }}>{title}</div>
      <div style={{ fontSize: 36, opacity: 0.9 }}>{subtitle}</div>
    </div>
  );

  return new ImageResponse(
    cover ? (
      // Cover photo full-bleed, with a dark scrim so white text stays legible.
      <div style={{ position: 'relative', display: 'flex', width: '100%', height: '100%' }}>
        <img
          src={cover}
          alt=""
          width={size.width}
          height={size.height}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0.8) 100%)',
          }}
        />
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            height: '100%',
            padding: 80,
            color: 'white',
            fontFamily: 'sans-serif',
          }}
        >
          {Brand}
          {Text}
        </div>
      </div>
    ) : (
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
        {Brand}
        {Text}
      </div>
    ),
    { ...size }
  );
}
