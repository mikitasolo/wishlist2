// Pure helpers for the share cards (the Open Graph images a messenger shows for
// a shared link): their background, sizes, text fitting, and how long Vercel's
// CDN may keep one. The cards themselves are built in lib/og/.

import { coverGradient } from '@/lib/utils/cover';

/** Every share card is 1200×630, the size Open Graph and X both expect. */
export const OG_CARD_SIZE = { width: 1200, height: 630 } as const;

/**
 * A list's in-app cover gradient (`coverGradient`), as next/og can draw it.
 * Satori blends a `transparent` stop as transparent *black*, which turns each
 * cover's soft highlight into a muddy band. So each `transparent` becomes the
 * colour of the stop before it at zero alpha, which is what a browser shows.
 * A card for a list without a banner then matches the list's own cover.
 */
export function ogCoverBackground(seed: string): string {
  return coverGradient(seed).replace(
    /#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2}) (\d+%), transparent/gi,
    (_, r: string, g: string, b: string, stop: string) =>
      `#${r}${g}${b} ${stop}, rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, 0)`
  );
}

/**
 * Cut `text` to at most `max` characters, ending in an ellipsis when it was
 * longer. Counted in code points, so an emoji is never split in half. The card
 * also clamps by lines; this keeps a 300-character bio from being laid out at
 * all, and the card's text predictable.
 */
export function clampText(text: string, max: number): string {
  const chars = Array.from(text.trim());
  if (chars.length <= max) return chars.join('');
  const kept = chars
    .slice(0, max - 1)
    .join('')
    .trimEnd();
  return `${kept}…`;
}

/** A list's name on its card: big when short, smaller as it grows. */
export function titleFontSize(title: string): number {
  const length = Array.from(title).length;
  if (length <= 22) return 84;
  if (length <= 44) return 68;
  return 56;
}

/**
 * Bots get a list's or profile's page only once its metadata resolves, so a
 * slow or cold DB must not hold it: past this, the page gets the site defaults.
 */
export const METADATA_BUDGET_MS = 2000;

/** How long Vercel's CDN keeps a card that showed real data: a day. */
export const CARD_CDN_MAX_AGE_SECONDS = 24 * 60 * 60;

/** The cache tag on a list's card, purged when anything it shows changes. */
export function wishlistCardTag(wishlistId: string): string {
  return `og-wishlist-${wishlistId}`;
}

/**
 * The cache tag on a user's profile card, and on the card of every list they're
 * the primary owner of (which shows their username).
 */
export function userCardTag(userId: string): string {
  return `og-user-${userId}`;
}

/**
 * The cache tag on a share link's own card (`/l/<token>`, WIS-336), purged when
 * the link is revoked or its expiry edited. Built from the link's id, never its
 * token: tags go to Vercel's purge API and its logs.
 */
export function shareLinkCardTag(linkId: string): string {
  return `og-link-${linkId}`;
}

/**
 * How long the CDN may keep a share link's card: a day, but never past the
 * link's expiry, since nothing purges a card when a link simply runs out. Zero
 * (don't cache) once it has expired or is about to.
 */
export function shareLinkCardMaxAge(expiresAt: Date | null, now: number = Date.now()): number {
  if (!expiresAt) return CARD_CDN_MAX_AGE_SECONDS;
  const left = Math.floor((expiresAt.getTime() - now) / 1000);
  return Math.max(0, Math.min(CARD_CDN_MAX_AGE_SECONDS, left));
}

/**
 * Response headers for a card. Only a card that showed real, current data is
 * cached, and only on Vercel's CDN: for a day (or `maxAgeSeconds`, if shorter),
 * under `tags`, so the writes that change it can purge it (lib/og/purge.ts).
 * Everything else (a hidden or missing list, a dead share link, a missing user,
 * a fallback after a timeout or a failed photo) gets `no-store`, so a cold start
 * can't pin a generic card for a day, and a hidden list's card looks exactly
 * like a missing one's, headers included.
 */
export function shareCardHeaders(
  tags: readonly string[] | null,
  maxAgeSeconds: number = CARD_CDN_MAX_AGE_SECONDS
): Record<string, string> {
  const maxAge = Math.min(CARD_CDN_MAX_AGE_SECONDS, Math.floor(maxAgeSeconds));
  if (!tags?.length || !(maxAge > 0)) return { 'Cache-Control': 'no-store' };
  return {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Vercel-CDN-Cache-Control': `public, max-age=${maxAge}`,
    'Vercel-Cache-Tag': tags.join(','),
  };
}

/**
 * Race a promise against a timeout. Share cards and share metadata are fetched
 * by crawlers that give up after a few seconds, so a hung DB connect or a slow
 * photo must fall back to a generic answer instead of holding the response.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('og-timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
