import mongoose, { type FilterQuery } from 'mongoose';
import connectDB from '@/lib/mongodb';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { areFriends } from '@/lib/utils/friends';
import { getVisibility, type Visibility } from '@/lib/utils/visibility';
import { isWishlistOwner, ownedByFilter, ownerIds } from '@/lib/utils/wishlistOwners';

/**
 * Management access to a wishlist: owners only. There's no middle tier — anyone
 * trusted to manage a list is a co-owner of it (see `models/WishlistMember.ts`).
 *
 * Returns the wishlist doc too so callers can reuse it. `wishlist` is undefined
 * only when the id doesn't exist.
 */
export async function getOwnerAccess(
  wishlistId: string,
  userId: string
): Promise<{ isOwner: boolean; wishlist?: IWishlist }> {
  await connectDB();
  const wishlist = await Wishlist.findById(wishlistId);
  if (!wishlist) return { isOwner: false };
  return { isOwner: isWishlistOwner(wishlist, userId), wishlist };
}

/** Lightweight boolean variant — only fetches what's needed. */
export async function isOwnerOfWishlist(wishlistId: string, userId: string): Promise<boolean> {
  await connectDB();
  const wishlist = await Wishlist.findById(wishlistId).select('owners');
  return !!wishlist && isWishlistOwner(wishlist, userId);
}

/** The fields of a wishlist that decide who may see it. */
type ViewedWishlist = Pick<IWishlist, '_id' | 'owners' | 'visibility' | 'isPublic' | 'archived'>;

/**
 * The list's visibility tier, failing closed on an old document. `isPublic` is
 * the legacy flag, kept in sync with `visibility` (everyone ⇔ true) by every
 * write. A list saved before `visibility` existed has only `isPublic`, but a
 * hydrated doc fills the missing field with the schema default `everyone` (and
 * a `save()` of one stores it), so `isPublic: false` wins: that list is private.
 *
 * `EVERYONE_TIER` below is the same rule as a query. Change the two together.
 */
function viewTier(wishlist: ViewedWishlist): Visibility {
  const tier = getVisibility(wishlist);
  return tier === 'everyone' && wishlist.isPublic === false ? 'private' : tier;
}

/**
 * `viewTier(w) === 'everyone'` as a query, over the stored document. A missing
 * `visibility` hydrates as `everyone`, so it counts as `everyone` here too, and
 * `isPublic: false` wins over both, as in `viewTier`.
 */
const EVERYONE_TIER: FilterQuery<IWishlist> = {
  visibility: { $in: ['everyone', null] },
  isPublic: { $ne: false },
};

type Id = string | mongoose.Types.ObjectId;
const toObjectIds = (ids: Id[]) => ids.map((id) => new mongoose.Types.ObjectId(id.toString()));

/** A signed-in viewer's relationships, as `viewableWishlistsFilter` needs them. */
export interface WishlistViewer {
  id: string;
  /** The lists they're a member of (their `WishlistMember` rows). */
  memberOf: Id[];
  /** Their friends (mutual follows). */
  friendIds: Id[];
}

/**
 * `getWishlistViewAccess` as a query: it matches exactly the lists `viewer` may
 * open (pass `null` when signed out). It's for listings that can't check every
 * document one by one, such as search. Its ids are ObjectIds, so it also works
 * as an aggregation `$match`, which doesn't cast.
 *
 * A table test pins it to `getWishlistViewAccess` over every visibility,
 * archived and relationship combination (`test/api/viewableWishlistsFilter.test.ts`),
 * so the two can't drift apart.
 */
export function viewableWishlistsFilter(viewer: WishlistViewer | null): FilterQuery<IWishlist> {
  if (!viewer) return { archived: { $ne: true }, ...EVERYONE_TIER };
  const owned = ownedByFilter(viewer.id);
  return {
    $and: [
      // isHiddenByArchive: an archived list is its owners' alone.
      { $or: [{ archived: { $ne: true } }, owned] },
      {
        $or: [
          EVERYONE_TIER,
          // Owners and members get in at every tier.
          owned,
          { _id: { $in: toObjectIds(viewer.memberOf) } },
          // `friends` admits a friend of *any* owner.
          { visibility: 'friends', owners: { $in: toObjectIds(viewer.friendIds) } },
        ],
      },
    ],
  };
}

/**
 * Whether an archived list must look nonexistent to `userId`. Archived lists are
 * owner-only: anyone else, signed in or not, gets the same 404 as for a list
 * that doesn't exist, whatever they ask of it (view, propose, book).
 */
export function isHiddenByArchive(
  wishlist: Pick<IWishlist, 'owners' | 'archived'>,
  userId?: string | null
): boolean {
  return !!wishlist.archived && !isWishlistOwner(wishlist, userId);
}

export type WishlistViewAccess =
  | { allowed: true; isOwner: boolean; isMember: boolean }
  | { allowed: false; status: 401 | 403 | 404; error: string };

/**
 * Who may see a wishlist and what's on it. The single rule set behind both
 * `GET /api/wishlists/[id]` and `GET /api/wishlists/[id]/items`, so a list and
 * its items can never disagree about who sees them:
 *
 *  - archived: owners only; everyone else gets 404 (see `isHiddenByArchive`);
 *  - `everyone`: anyone, signed in or not (see `viewTier` for old documents);
 *  - `friends` / `private`: 401 when signed out. Owners and members get in at
 *    either tier, and `friends` also admits a mutual friend of *any* owner — a
 *    co-owned list behaves as if each owner created it.
 *
 * On success, `isOwner` / `isMember` are the viewer's relationship to the list
 * (a friend who isn't a member is neither). Errors carry the status and message
 * to answer with.
 */
export async function getWishlistViewAccess(
  wishlist: ViewedWishlist,
  viewerId?: string | null
): Promise<WishlistViewAccess> {
  if (isHiddenByArchive(wishlist, viewerId)) {
    return { allowed: false, status: 404, error: 'Wishlist not found' };
  }

  // Every co-owner is an owner here — same authorization, same booking blindness.
  const isOwner = isWishlistOwner(wishlist, viewerId);
  const isMember =
    !!viewerId &&
    !isOwner &&
    !!(await WishlistMember.exists({ wishlist: wishlist._id, user: viewerId }));
  const granted = { allowed: true as const, isOwner, isMember };

  const visibility = viewTier(wishlist);
  if (visibility === 'everyone') return granted;

  if (!viewerId) {
    return { allowed: false, status: 401, error: 'Unauthorized - This wishlist is private' };
  }
  if (isOwner || isMember) return granted;

  if (visibility === 'friends') {
    const friendChecks = await Promise.all(
      ownerIds(wishlist).map((ownerId) => areFriends(viewerId, ownerId))
    );
    if (friendChecks.some(Boolean)) return granted;
  }

  return { allowed: false, status: 403, error: 'Unauthorized - No access to this wishlist' };
}
