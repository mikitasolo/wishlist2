import { ImageResponse } from 'next/og';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { ogGradient, fetchImageDataUri, withTimeout } from '@/lib/utils/og';

export const alt = 'Profile on Wishlist';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Bound data work so a slow DB/avatar can't turn the crawler image into a 500.
const DATA_BUDGET_MS = 4000;

interface CardData {
  handle: string;
  tagline: string;
  initial: string;
  avatar: string | null;
}

export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;

  let data: CardData = {
    handle: 'Wishlist',
    tagline: 'Create and share your wishlist',
    initial: 'W',
    avatar: null,
  };

  async function gather(): Promise<CardData> {
    await connectDB();
    const u = await User.findOne({ username }).select('username image bio privacy').lean();
    if (!u) return data;
    // Bio is hidden from non-friends when profileVisibility is 'friends';
    // crawlers are never friends, so only surface it for open profiles.
    const bioVisible = u.privacy?.profileVisibility !== 'friends';
    return {
      handle: `@${u.username}`,
      initial: (u.username?.[0] || 'W').toUpperCase(),
      // Username and avatar are always public.
      avatar: await fetchImageDataUri(u.image),
      tagline: bioVisible && u.bio ? u.bio : 'on Wishlist',
    };
  }

  try {
    data = await withTimeout(gather(), DATA_BUDGET_MS);
  } catch {
    // Timeout or lookup failure → fast generic card.
  }

  const { handle, tagline, initial, avatar } = data;
  const g = ogGradient(username || handle);

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
        width: '100%',
        height: '100%',
        padding: 80,
        backgroundImage: g.css,
        color: 'white',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          width: 180,
          height: 180,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.22)',
          border: '6px solid rgba(255,255,255,0.85)',
          fontSize: 88,
          fontWeight: 800,
        }}
      >
        {avatar ? (
          <img
            src={avatar}
            alt=""
            width={180}
            height={180}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          initial
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div style={{ fontSize: 68, fontWeight: 800 }}>{handle}</div>
        <div style={{ fontSize: 34, opacity: 0.92, textAlign: 'center' }}>{tagline}</div>
      </div>
    </div>,
    { ...size }
  );
}
