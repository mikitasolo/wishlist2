import type { ReactElement, ReactNode } from 'react';
import { LOGO_SVG } from '@/lib/brandLogo';
import { clampText, OG_CARD_SIZE, ogCoverBackground, titleFontSize } from '@/lib/utils/og';
import { formatItemCount } from '@/lib/utils/itemCounts';

// The share cards' layouts, as next/og (Satori) elements: flexbox only, inline
// styles, and every <div> with more than one child needs `display: flex`.
// lib/og/shareCards.ts decides which card a link gets and with what data.

export const CARD_FONT = 'Geist';

const LOGO_SRC = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;
// The logo's own colours, for the cards that have no list or person to echo.
const BRAND_BACKGROUND = 'linear-gradient(135deg, #8f8dff 0%, #5e5ce6 52%, #4644c0 100%)';
const TEXT_SHADOW = '0 2px 16px rgba(0, 0, 0, 0.22)';

/** The "Wishlist" chip in a card's top-left corner. */
function BrandChip() {
  return (
    <div
      style={{
        display: 'flex',
        alignSelf: 'flex-start',
        alignItems: 'center',
        gap: 14,
        padding: '10px 26px 10px 10px',
        borderRadius: 999,
        background: 'rgba(255, 255, 255, 0.94)',
        color: '#25233f',
        fontSize: 30,
        fontWeight: 700,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, not next/image */}
      <img src={LOGO_SRC} width={46} height={46} alt="" />
      Wishlist
    </div>
  );
}

/**
 * A card's frame: a background (a gradient, or a photo drawn over it), a scrim
 * that keeps white text readable on any of them, and the content on top.
 */
function Frame({
  background,
  photo,
  scrim,
  children,
}: {
  background: string;
  photo?: string | null;
  scrim: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundImage: background,
        color: 'white',
        fontFamily: CARD_FONT,
      }}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, not next/image
        <img
          src={photo}
          width={OG_CARD_SIZE.width}
          height={OG_CARD_SIZE.height}
          alt=""
          style={{ position: 'absolute', top: 0, left: 0 }}
        />
      ) : null}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: scrim,
        }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          padding: 64,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** The logo, large and faint, in the corner of the cards that show no one's list. */
function Watermark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, not next/image
    <img
      src={LOGO_SRC}
      width={440}
      height={440}
      alt=""
      style={{ position: 'absolute', right: -70, bottom: -90, opacity: 0.16 }}
    />
  );
}

/** A big title over a smaller line, at the bottom of the card. */
function Caption({ title, subtitle, size }: { title: string; subtitle: string; size: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 'auto' }}>
      <div
        style={{
          display: 'block',
          fontSize: size,
          fontWeight: 700,
          lineHeight: 1.08,
          lineClamp: 2,
          textShadow: TEXT_SHADOW,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', fontSize: 36, opacity: 0.95, textShadow: TEXT_SHADOW }}>
        {subtitle}
      </div>
    </div>
  );
}

function itemCount(count: number): string {
  return count === 0 ? 'No items yet' : formatItemCount(count);
}

/** A list a signed-out visitor could open: its name, owner, item count, and banner or cover. */
export function wishlistCard({
  id,
  name,
  ownerUsername,
  count,
  photo,
}: {
  id: string;
  name: string;
  ownerUsername: string | null;
  count: number;
  photo: string | null;
}): ReactElement {
  const title = clampText(name, 80);
  const subtitle = [ownerUsername ? `by @${ownerUsername}` : null, itemCount(count)]
    .filter(Boolean)
    .join(' · ');
  return (
    <Frame
      background={ogCoverBackground(id)}
      photo={photo}
      scrim={
        photo
          ? 'linear-gradient(180deg, rgba(0, 0, 0, 0.18) 0%, rgba(0, 0, 0, 0) 30%, rgba(0, 0, 0, 0.1) 52%, rgba(0, 0, 0, 0.74) 100%)'
          : 'linear-gradient(180deg, rgba(0, 0, 0, 0) 45%, rgba(0, 0, 0, 0.22) 100%)'
      }
    >
      <BrandChip />
      <Caption title={title} subtitle={subtitle} size={titleFontSize(title)} />
    </Frame>
  );
}

/**
 * Any other list: friends-only, private, archived, missing, or one we couldn't
 * read in time. All of them look the same, so a preview never tells a private
 * list from one that doesn't exist.
 */
export function hiddenWishlistCard(): ReactElement {
  return (
    <Frame
      background={BRAND_BACKGROUND}
      scrim="linear-gradient(180deg, rgba(0, 0, 0, 0) 50%, rgba(0, 0, 0, 0.18) 100%)"
    >
      <Watermark />
      <BrandChip />
      <Caption title="A wishlist" subtitle="Open the link to see what's on it" size={84} />
    </Frame>
  );
}

/** The default card: the home page, and a profile link that matches no one. */
export function siteCard(): ReactElement {
  return (
    <Frame
      background={BRAND_BACKGROUND}
      scrim="linear-gradient(180deg, rgba(0, 0, 0, 0) 50%, rgba(0, 0, 0, 0.18) 100%)"
    >
      <Watermark />
      <BrandChip />
      <Caption
        title="Share lists. Gift without spoilers."
        subtitle="Reserve gifts for friends and family, no duplicates"
        size={74}
      />
    </Frame>
  );
}

/** A profile: avatar (or initial), username, and bio unless it's friends-only. */
export function profileCard({
  id,
  username,
  bio,
  photo,
}: {
  id: string;
  username: string;
  bio: string | null;
  photo: string | null;
}): ReactElement {
  const avatarSize = 184;
  return (
    <Frame
      background={ogCoverBackground(id)}
      scrim="linear-gradient(180deg, rgba(0, 0, 0, 0.06) 0%, rgba(0, 0, 0, 0.2) 100%)"
    >
      <BrandChip />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flexGrow: 1,
          gap: 18,
        }}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, not next/image
          <img
            src={photo}
            width={avatarSize}
            height={avatarSize}
            alt=""
            style={{ borderRadius: 999, border: '6px solid rgba(255, 255, 255, 0.92)' }}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: avatarSize,
              height: avatarSize,
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.24)',
              border: '6px solid rgba(255, 255, 255, 0.92)',
              fontSize: 96,
              fontWeight: 700,
              textShadow: TEXT_SHADOW,
            }}
          >
            {Array.from(username)[0]?.toUpperCase() ?? 'W'}
          </div>
        )}
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, textShadow: TEXT_SHADOW }}>
          {`@${username}`}
        </div>
        <div
          style={{
            display: 'block',
            maxWidth: 960,
            fontSize: 34,
            lineHeight: 1.3,
            lineClamp: 2,
            textAlign: 'center',
            opacity: 0.95,
            textShadow: TEXT_SHADOW,
          }}
        >
          {bio ? clampText(bio, 160) : 'on Wishlist'}
        </div>
      </div>
    </Frame>
  );
}
