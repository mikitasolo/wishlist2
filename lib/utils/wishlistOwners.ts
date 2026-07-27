import mongoose, { FilterQuery } from 'mongoose';
import type { IWishlist } from '@/models/Wishlist';

/**
 * Reading the owner set of a wishlist.
 *
 * Ownership is a *set* (`Wishlist.owners`), not a single user: all owners are
 * equal — same authorization, same privacy (no owner ever sees booking status),
 * the list appears on each of their profiles, and each can pin it to their own
 * dashboard. Everything that used to compare `wishlist.owner.toString() ===
 * userId` goes through `isWishlistOwner` here instead.
 */

/** The subset of a wishlist these helpers need — a doc, a `.lean()` row, or a plain object. */
export type OwnedWishlist = Pick<IWishlist, 'owners'>;

type Featurable = Pick<IWishlist, 'featuredBy'>;

function toIdString(v: unknown): string {
  return typeof v === 'string' ? v : String(v);
}

/** Every owner's id, as strings. Never empty for a well-formed wishlist. */
export function ownerIds(wishlist: OwnedWishlist): string[] {
  return Array.isArray(wishlist.owners) ? wishlist.owners.map(toIdString) : [];
}

/**
 * The "primary" owner — `owners[0]`, i.e. whoever created the list (or the
 * earliest remaining owner). Owners are equal in authority, so this is only for
 * places that structurally need a single user: display fallbacks (`@x's
 * wishlist`) and the recipient snapshot on a `Reservation` / `GiftLog`.
 */
export function primaryOwnerId(wishlist: OwnedWishlist): string | null {
  return ownerIds(wishlist)[0] ?? null;
}

/** Whether `userId` is one of this wishlist's owners. */
export function isWishlistOwner(wishlist: OwnedWishlist, userId?: string | null): boolean {
  if (!userId) return false;
  return ownerIds(wishlist).includes(userId);
}

/** Query filter for "wishlists owned by this user". */
export function ownedByFilter(userId: string): FilterQuery<IWishlist> {
  return { owners: new mongoose.Types.ObjectId(userId) };
}

/** Whether this list is `userId`'s pinned dashboard highlight. */
export function isFeaturedBy(wishlist: Featurable, userId?: string | null): boolean {
  if (!userId) return false;
  const by = wishlist.featuredBy;
  return Array.isArray(by) && by.map(toIdString).includes(userId);
}

/** A wishlist as clients see it: owner ids as strings, `featured` per-viewer. */
export type ApiWishlist = Omit<IWishlist, 'owners' | 'featuredBy'> & {
  owners: string[];
  featured: boolean;
};

/**
 * Shape a wishlist for an API response: exposes the owner set as plain id
 * strings, folds the per-owner `featuredBy` set down to the boolean `featured`
 * *this viewer* cares about (so a co-owner's dashboard pin never reads as
 * yours), and drops the deprecated single-owner fields so clients can't start
 * depending on them again.
 */
export function serializeWishlist(
  wishlist: IWishlist & { toObject?: () => unknown },
  viewerId?: string | null
): ApiWishlist {
  const raw = (
    typeof wishlist.toObject === 'function' ? wishlist.toObject() : { ...wishlist }
  ) as IWishlist;
  const { owners: _owners, featuredBy: _featuredBy, ...rest } = raw;
  return {
    ...rest,
    owners: ownerIds(wishlist),
    featured: isFeaturedBy(wishlist, viewerId),
  };
}
