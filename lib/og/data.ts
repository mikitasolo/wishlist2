import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import User from '@/models/User';
import Item from '@/models/Item';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { primaryOwnerId } from '@/lib/utils/wishlistOwners';
import { getWishlistViewAccess } from '@/lib/utils/wishlistAccess';

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

const HIDDEN: WishlistCardData = { kind: 'hidden' };

export async function readWishlistCard(idOrSlug: string): Promise<WishlistCardData> {
  await connectDB();
  const id = await resolveWishlistId(idOrSlug);
  if (!id) return HIDDEN;
  const wishlist = await Wishlist.findById(id)
    .select('name slug owners visibility archived bannerUrl updatedAt')
    .lean();
  if (!wishlist || !(await getWishlistViewAccess(wishlist, null)).allowed) return HIDDEN;

  // A co-owned list is credited to its primary owner.
  const ownerId = primaryOwnerId(wishlist);
  const owner = ownerId ? await User.findById(ownerId).select('username updatedAt').lean() : null;
  return {
    kind: 'public',
    id,
    name: wishlist.name,
    slug: wishlist.slug ?? null,
    bannerUrl: wishlist.bannerUrl ?? null,
    ownerId,
    ownerUsername: owner?.username ?? null,
    updatedAt: wishlist.updatedAt,
    ownerUpdatedAt: owner?.updatedAt ?? null,
  };
}

/** Item statuses a visitor never sees: drafts, and proposals awaiting review. */
const UNSEEN_ITEM_STATUSES = ['draft', 'proposed'];

/**
 * Whether an item in this status counts towards the item count on its list's
 * card. A write that moves an item in or out of the count (adding, deleting,
 * publishing, drafting, approving) purges the card (lib/og/purge.ts).
 */
export function isCountedOnShareCard(status: string): boolean {
  return !UNSEEN_ITEM_STATUSES.includes(status);
}

/** How many items a visitor sees on a list (`isCountedOnShareCard`). */
export async function countVisibleItems(wishlistId: string): Promise<number> {
  await connectDB();
  return Item.countDocuments({ wishlist: wishlistId, status: { $nin: UNSEEN_ITEM_STATUSES } });
}

/**
 * Whether the list and its primary owner are still as `card` read them. Every
 * write that changes what a card shows (lib/og/purge.ts) also bumps the
 * `updatedAt` of the list or the user it changes.
 */
export async function isWishlistCardCurrent(
  card: Extract<WishlistCardData, { kind: 'public' }>
): Promise<boolean> {
  await connectDB();
  const [list, owner] = await Promise.all([
    Wishlist.exists({ _id: card.id, updatedAt: card.updatedAt }),
    card.ownerId && card.ownerUpdatedAt
      ? User.exists({ _id: card.ownerId, updatedAt: card.ownerUpdatedAt })
      : true,
  ]);
  return !!list && !!owner;
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
