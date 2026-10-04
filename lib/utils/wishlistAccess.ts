import mongoose, { type FilterQuery } from 'mongoose';
import connectDB from '@/lib/mongodb';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { areFriends } from '@/lib/utils/friends';
import { isWishlistOwner, ownedByFilter, ownerIds } from '@/lib/utils/wishlistOwners';

/**
 * Management access to a wishlist: owners only. There's no middle tier — anyone
 * trusted to manage a list is a co-owner of it (see `models/WishlistMember.ts`).
 *
 * Returns the wishlist doc too so callers can reuse it. `wishlist` is undefined
 * when the id doesn't exist, and also when the list is archived and `userId`
 * isn't one of its owners (`isHiddenByArchive`). An archived list is its owners'
 * alone, so every owner-only request answers anyone else exactly as it answers
 * for a list that doesn't exist, not with a 403 that would confirm it does. The
 * same goes for the re-read that picks the answer once a conditional owner write
 * has matched nothing: an owner who lost ownership mid-request is anyone else.
 * A non-owner of a list that isn't archived gets `isOwner: false`, to be refused
 * with a 403: that list's existence is no secret (see `getWishlistViewAccess`).
 */
export async function getOwnerAccess(
  wishlistId: string,
  userId: string
): Promise<{ isOwner: boolean; wishlist?: IWishlist }> {
  await connectDB();
  const wishlist = await Wishlist.findById(wishlistId);
  if (!wishlist || isHiddenByArchive(wishlist, userId)) return { isOwner: false };
  return { isOwner: isWishlistOwner(wishlist, userId), wishlist };
}

/**
 * Lightweight boolean variant — only fetches what's needed. A bare ownership
 * check: it can't tell a hidden archived list from a refused caller, so a route
 * authorizes an owner-only request through `getOwnerAccess` instead.
 */
export async function isOwnerOfWishlist(wishlistId: string, userId: string): Promise<boolean> {
  await connectDB();
  const wishlist = await Wishlist.findById(wishlistId).select('owners');
  return !!wishlist && isWishlistOwner(wishlist, userId);
}

/** The fields of a wishlist that decide who may see it. */
type ViewedWishlist = Pick<IWishlist, '_id' | 'owners' | 'visibility' | 'archived'>;

/**
 * `getWishlistViewAccess`'s `visibility === 'everyone'` as a query. Change the
 * two together. Every stored list has a `visibility` (the schema requires it
 * and every write sets it), so the hydrated document that check reads and the
 * stored one this matches agree.
 */
const EVERYONE_TIER: FilterQuery<IWishlist> = { visibility: 'everyone' };

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
  return {
    $and: [
      // isHiddenByArchive: an archived list is its owners' alone.
      { $or: [{ archived: { $ne: true } }, ownedByFilter(viewer.id)] },
      viewableUnlessArchivedFilter(viewer),
    ],
  };
}

/**
 * `viewableWishlistsFilter` with archiving left out: the lists `viewer` may
 * open, or could if they weren't archived (visibility tier, ownership,
 * membership, any owner's friends). Only for a read that has to tell a list
 * hidden from them by its archiving alone from one hidden for any other reason
 * (the Booked page's reservations, `readReservationWishlists`); anything that
 * admits a viewer goes through `viewableWishlistsFilter`.
 */
export function viewableUnlessArchivedFilter(viewer: WishlistViewer): FilterQuery<IWishlist> {
  return {
    $or: [
      EVERYONE_TIER,
      // Owners and members get in at every tier.
      ownedByFilter(viewer.id),
      { _id: { $in: toObjectIds(viewer.memberOf) } },
      // `friends` admits a friend of *any* owner.
      { visibility: 'friends', owners: { $in: toObjectIds(viewer.friendIds) } },
    ],
  };
}

/**
 * Whether an archived list must look nonexistent to `userId`. Archived lists are
 * owner-only: anyone else, signed in or not, gets the same 404 as for a list
 * that doesn't exist, whatever they ask of it (view, propose, book, or anything
 * only an owner may do, through `getOwnerAccess`).
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
 *  - `everyone`: anyone, signed in or not;
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

  // `EVERYONE_TIER` is this check as a query. Anything that isn't `everyone` or
  // `friends` gets the `private` rules.
  const { visibility } = wishlist;
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
