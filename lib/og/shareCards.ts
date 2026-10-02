import type { ReactElement } from 'react';
import { errorKind } from '@/lib/utils/errorKind';
import { shareCardHeaders, userCardTag, wishlistCardTag, withTimeout } from '@/lib/utils/og';
import { hiddenWishlistCard, profileCard, siteCard, wishlistCard } from './cards';
import {
  countVisibleItems,
  isProfileCardCurrent,
  isWishlistCardCurrent,
  readProfileCard,
  readWishlistCard,
  type ProfileCardData,
  type WishlistCardData,
} from './data';
import { loadCardPhoto, type CardPhoto } from './photo';
import { renderCardImage, type CardImage } from './render';

// The share cards behind app/**/opengraph-image.tsx. A crawler fetches one
// signed out and gives up after a few seconds, so each is built to answer fast
// and never fail: the data gets DATA_BUDGET_MS, the photo PHOTO_BUDGET_MS
// (lib/og/photo.ts), drawing RENDER_BUDGET_MS, and anything that doesn't make it
// falls back to the generic card, which isn't cached.

/** Reading the list or user (and the item count) gets this long. */
export const DATA_BUDGET_MS = 2000;
/**
 * Drawing a card gets this long. next/og fetches what our fonts lack while it
 * draws (an emoji, a script other than Latin or Cyrillic), so a name can make it
 * wait on the network. The generic cards need nothing fetched.
 */
export const RENDER_BUDGET_MS = 3000;

const AVATAR_BOX = { width: 184, height: 184 };
const BANNER_BOX = { width: 1200, height: 630 };

function respond({ body, contentType }: CardImage, tags: readonly string[] | null): Response {
  return new Response(new Uint8Array(body), {
    headers: { 'Content-Type': contentType, ...shareCardHeaders(tags) },
  });
}

/** The generic card for anything we can't or won't show, never cached. */
async function fallback(card: () => ReactElement): Promise<Response> {
  return respond(await renderCardImage(card()), null);
}

/**
 * Whether a drawn card may be kept by the CDN: its photo, if it has one of ours,
 * made it, and what it shows was still current once it was drawn. A write that
 * landed while it was being drawn purged a cache this card wasn't in yet, so
 * caching it would keep the old data for a day. What's left is a write and its
 * purge both landing in the moment between this check and the CDN storing the
 * card; the card's one-day TTL bounds that.
 */
async function cacheable(photo: CardPhoto, isCurrent: () => Promise<boolean>): Promise<boolean> {
  if (photo.status === 'failed') return false;
  try {
    return await withTimeout(isCurrent(), DATA_BUDGET_MS);
  } catch {
    return false;
  }
}

/** The card for `/wishlists/<id or slug>`. */
export async function wishlistShareCard(idOrSlug: string): Promise<Response> {
  let data: WishlistCardData;
  try {
    data = await withTimeout(readWishlistCard(idOrSlug), DATA_BUDGET_MS);
  } catch (err) {
    console.error('Wishlist share card read failed, sending the generic card:', errorKind(err));
    return fallback(hiddenWishlistCard);
  }
  if (data.kind !== 'public') return fallback(hiddenWishlistCard);
  const card = data;

  try {
    // The banner loads while the items are counted.
    const [count, photo] = await Promise.all([
      withTimeout(countVisibleItems(card.id), DATA_BUDGET_MS),
      loadCardPhoto(card.bannerUrl, BANNER_BOX),
    ]);
    const image = await withTimeout(
      renderCardImage(
        wishlistCard({
          id: card.id,
          name: card.name,
          ownerUsername: card.ownerUsername,
          count,
          photo: photo.status === 'ok' ? photo.src : null,
        })
      ),
      RENDER_BUDGET_MS
    );
    const tags = [wishlistCardTag(card.id), ...(card.ownerId ? [userCardTag(card.ownerId)] : [])];
    return respond(
      image,
      (await cacheable(photo, () => isWishlistCardCurrent(card))) ? tags : null
    );
  } catch (err) {
    console.error('Wishlist share card failed, sending the generic card:', errorKind(err));
    return fallback(hiddenWishlistCard);
  }
}

/** The card for `/users/<username>`. */
export async function profileShareCard(username: string): Promise<Response> {
  let data: ProfileCardData;
  try {
    data = await withTimeout(readProfileCard(username), DATA_BUDGET_MS);
  } catch (err) {
    console.error('Profile share card read failed, sending the generic card:', errorKind(err));
    return fallback(siteCard);
  }
  if (data.kind !== 'user') return fallback(siteCard);
  const card = data;

  try {
    const photo = await loadCardPhoto(card.image, AVATAR_BOX);
    const image = await withTimeout(
      renderCardImage(
        profileCard({
          id: card.id,
          username: card.username,
          bio: card.bio,
          photo: photo.status === 'ok' ? photo.src : null,
        })
      ),
      RENDER_BUDGET_MS
    );
    const current = await cacheable(photo, () => isProfileCardCurrent(card));
    return respond(image, current ? [userCardTag(card.id)] : null);
  } catch (err) {
    console.error('Profile share card failed to draw, sending the generic card:', errorKind(err));
    return fallback(siteCard);
  }
}
