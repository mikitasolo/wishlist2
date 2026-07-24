import { ImageResponse } from 'next/og';
import { ogGradient } from '@/lib/utils/og';

// Default share card for pages without their own (e.g. the home page). No DB or
// network work, so it renders instantly and can never time out into a 500.
export const alt = 'Wishlist — share lists and gift without spoilers';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  const g = ogGradient('wishlist');
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 28,
        width: '100%',
        height: '100%',
        padding: 90,
        backgroundImage: g.css,
        color: 'white',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 40, fontWeight: 700 }}
      >
        <div
          style={{
            display: 'flex',
            width: 52,
            height: 52,
            borderRadius: 14,
            background: 'rgba(255,255,255,0.9)',
          }}
        />
        Wishlist
      </div>
      <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.05 }}>
        Share lists. Gift without spoilers.
      </div>
      <div style={{ fontSize: 34, opacity: 0.9 }}>
        Reserve gifts for friends and family — no duplicates, no surprises ruined.
      </div>
    </div>,
    { ...size }
  );
}
