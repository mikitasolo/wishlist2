import { dangerouslyDeleteByTag } from '@vercel/functions';
import { errorKind } from '@/lib/utils/errorKind';
import { shareLinkCardTag, userCardTag, wishlistCardTag, withTimeout } from '@/lib/utils/og';

/** A purge that hasn't answered by then is given up on; the card's TTL is the backstop. */
export const PURGE_BUDGET_MS = 2000;

/**
 * Drop the cached share cards of these lists and users from Vercel's CDN, so the
 * next crawler gets one drawn from the data as it is now. Called once a write
 * that changes what a card shows has landed:
 *
 *  - a list's name, URL, visibility, archived flag or banner, its deletion, and
 *    a change to its primary owner (an owner removed, demoted or leaving);
 *  - a user's username, bio, profile visibility or avatar, which purges their
 *    profile card and the cards of the lists they're the primary owner of;
 *  - a share link revoked or its expiry edited (`shareLinkIds`). Its card is
 *    also tagged with its list's tag, so every list purge above drops the
 *    cards of the list's share links too.
 *
 * A cached card is deleted, not marked stale: a stale one is served once more
 * while it refreshes, which for a list just made private would show its name
 * again. Best-effort: a failure is logged (never the ids) and the write still
 * succeeds, and the card's one-day TTL (`CARD_CDN_MAX_AGE_SECONDS`) bounds how
 * long a missed purge leaves it. Outside Vercel (local dev, tests) there's no
 * CDN and this does nothing.
 */
export async function purgeShareCards({
  wishlistIds = [],
  userIds = [],
  shareLinkIds = [],
}: {
  wishlistIds?: readonly string[];
  userIds?: readonly string[];
  shareLinkIds?: readonly string[];
}): Promise<void> {
  const tags = [
    ...wishlistIds.map(wishlistCardTag),
    ...userIds.map(userCardTag),
    ...shareLinkIds.map(shareLinkCardTag),
  ];
  if (!tags.length) return;
  try {
    await withTimeout(dangerouslyDeleteByTag(tags), PURGE_BUDGET_MS);
  } catch (err) {
    console.error('Share card cache purge failed:', errorKind(err));
  }
}
