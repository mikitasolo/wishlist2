import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import User from '@/models/User';
import Item from '@/models/Item';
import ShareLink from '@/models/ShareLink';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { primaryOwnerId } from '@/lib/utils/wishlistOwners';
import { getWishlistViewAccess } from '@/lib/utils/wishlistAccess';
import { isPublishedItem, PUBLISHED_ITEM_STATUSES } from '@/lib/utils/itemCounts';
import { resolveShareLink, unexpiredShareLinkFilter } from '@/lib/utils/shareLinks';
import type { IWishlist } from '@/models/Wishlist';

/**
 * What a shared link's preview may show. A crawler fetches it signed out, and
 * the messenger then shows it to everyone in the chat and keeps its own copy,
 * so it carries only what a signed-out visitor could see:
 *
 *  - a list: its name, banner, primary owner and item count only when a
 *    signed-out visitor could open it (`getWishlistViewAccess`: public and not
 *    archived). Any other list is `hidden`, exactly like a list that doesn't
 *    exist, so a preview never confirms that a private list is there;
 *  - a profile: the username and avatar (always public), and the bio unless the
 *    profile is friends-only.
 *
 * Each also carries the `updatedAt` it was read at, so a card can check, once
 * rendered, that what it shows is still current before the CDN keeps it.
 */
export type WishlistCardData =
  | {
      kind: 'public';
      id: string;
      name: string;
      slug: string | null;
      bannerUrl: string | null;
      /** The occasion's kind only (never its date), which picks the cover pattern. */
      occasionKind: string | null;
      ownerId: string | null;
      ownerUsername: string | null;
      updatedAt: Date;
      ownerUpdatedAt: Date | null;
    }
  | { kind: 'hidden' };

export type ProfileCardData =
  | {
      kind: 'user';
      id: string;
      username: string;
      /** Null when the profile is friends-only, or has no bio. */
      bio: string | null;
      image: string | null;
      updatedAt: Date;
    }
  | { kind: 'missing' };

/** A list's card that names it. */
export type ShownWishlistCard = Extract<WishlistCardData, { kind: 'public' }>;

/**
 * What a share link's preview (`/l/<token>`, WIS-336) may show: the list it
 * opens, named whatever its visibility (the owner chose to share the link), and
 * the link's id and expiry for its cache. A dead link (malformed, unknown,
 * revoked, expired, its list archived or gone) is `hidden`, exactly like a
 * missing list.
 */
export type ShareLinkCardData =
  (ShownWishlistCard & { linkId: string; expiresAt: Date | null }) | { kind: 'hidden' };

const HIDDEN = { kind: 'hidden' } as const;

export async function readWishlistCard(idOrSlug: string): Promise<WishlistCardData> {
  await connectDB();
  const id = await resolveWishlistId(idOrSlug);
  if (!id) return HIDDEN;
  const wishlist = await Wishlist.findById(id)
    .select('name slug owners visibility archived bannerUrl occasion updatedAt')
    .lean();
  if (!wishlist || !(await getWishlistViewAccess(wishlist, null)).allowed) return HIDDEN;
  return shownCard(id, wishlist);
}

/**
 * The card of the list a live share link opens, else `hidden`. Resolved only
 * through `resolveShareLink` (which checks the token's shape before any query)
 * and admitted only through `getWishlistViewAccess` with that link, signed out:
 * a crawler is nobody. A failed read throws, for the caller's generic fallback.
 */
export async function readShareLinkCard(token: string): Promise<ShareLinkCardData> {
  const resolved = await resolveShareLink(token);
  if (!resolved) return HIDDEN;
  const { link, wishlist } = resolved;
  if (!(await getWishlistViewAccess(wishlist, null, { link })).allowed) return HIDDEN;
  return {
    ...(await shownCard(wishlist._id.toString(), wishlist)),
    linkId: link._id.toString(),
    expiresAt: link.expiresAt ?? null,
  };
}

async function shownCard(
  id: string,
  wishlist: Pick<IWishlist, 'name' | 'slug' | 'owners' | 'bannerUrl' | 'occasion' | 'updatedAt'>
): Promise<ShownWishlistCard> {
  // A co-owned list is credited to its primary owner.
  const ownerId = primaryOwnerId(wishlist);
  const owner = ownerId ? await User.findById(ownerId).select('username updatedAt').lean() : null;
  return {
    kind: 'public',
    id,
    name: wishlist.name,
    slug: wishlist.slug ?? null,
    bannerUrl: wishlist.bannerUrl ?? null,
    occasionKind: wishlist.occasion?.kind ?? null,
    ownerId,
    ownerUsername: owner?.username ?? null,
    updatedAt: wishlist.updatedAt,
    ownerUpdatedAt: owner?.updatedAt ?? null,
  };
}

/**
 * Whether an item in this status counts towards the item count on its list's
 * card: a published one, as on every other screen (`lib/utils/itemCounts.ts`),
 * never a draft or a proposal awaiting review. A write that moves an item in or
 * out of the count (adding, deleting, publishing, drafting, approving) purges
 * the card (lib/og/purge.ts).
 */
export const isCountedOnShareCard: (status: string) => boolean = isPublishedItem;

/** How many items a visitor sees on a list (`isCountedOnShareCard`). */
export async function countVisibleItems(wishlistId: string): Promise<number> {
  await connectDB();
  return Item.countDocuments({
    wishlist: wishlistId,
    status: { $in: [...PUBLISHED_ITEM_STATUSES] },
  });
}

/**
 * Whether the list and its primary owner are still as `card` read them. Every
 * write that changes what a card shows (lib/og/purge.ts) also bumps the
 * `updatedAt` of the list or the user it changes.
 */
export async function isWishlistCardCurrent(card: ShownWishlistCard): Promise<boolean> {
  await connectDB();
  const [list, owner] = await Promise.all([
    Wishlist.exists({ _id: card.id, updatedAt: card.updatedAt }),
    card.ownerId && card.ownerUpdatedAt
      ? User.exists({ _id: card.ownerId, updatedAt: card.ownerUpdatedAt })
      : true,
  ]);
  return !!list && !!owner;
}

/**
 * Whether a share link's card is still current: its list and owner as read
 * (`isWishlistCardCurrent`, which an archive also fails, by bumping the list's
 * `updatedAt`), and the link still there, still this list's, unexpired, with
 * the expiry it was read with. So a revoke or expiry edit racing the draw,
 * whose purge ran before this card was cached, keeps it out of the cache.
 */
export async function isShareLinkCardCurrent(
  card: Extract<ShareLinkCardData, { kind: 'public' }>
): Promise<boolean> {
  await connectDB();
  const [listCurrent, link] = await Promise.all([
    isWishlistCardCurrent(card),
    ShareLink.exists({
      _id: card.linkId,
      wishlist: card.id,
      expiresAt: card.expiresAt,
      ...unexpiredShareLinkFilter(),
    }),
  ]);
  return listCurrent && !!link;
}

export async function readProfileCard(username: string): Promise<ProfileCardData> {
  await connectDB();
  const user = await User.findOne({ username })
    .select('username bio image privacy updatedAt')
    .lean();
  if (!user?.username) return { kind: 'missing' };
  const bioVisible = user.privacy?.profileVisibility !== 'friends';
  return {
    kind: 'user',
    id: user._id.toString(),
    username: user.username,
    bio: (bioVisible && user.bio?.trim()) || null,
    image: user.image ?? null,
    updatedAt: user.updatedAt,
  };
}

/** Whether the user is still as `card` read them. */
export async function isProfileCardCurrent(
  card: Extract<ProfileCardData, { kind: 'user' }>
): Promise<boolean> {
  await connectDB();
  return !!(await User.exists({ _id: card.id, updatedAt: card.updatedAt }));
}
